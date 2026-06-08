/**
 * ScopeForge proposal agent service — the Node-only runtime that drives a
 * @kenkaiiii/gg-agent loop against a session's ProposalDraft.
 *
 * Transport-agnostic: it yields normalized {@link AgentStreamFrame}s an HTTP/SSE
 * layer (or a test) can consume directly. The service owns the cross-cutting
 * concerns the task requires:
 *
 * - **Streaming events** — model text/thinking deltas and tool lifecycle frames.
 * - **AbortSignal cancellation** — an external signal is chained to an internal
 *   controller so callers can cancel, and the service can self-abort on limits.
 * - **Max-turn / max-tool-call limits** — turns are capped by the Agent; the
 *   tool-call cap is enforced here by counting `tool_call_start` events.
 * - **Structured logging without secrets** — only provider/model/limits/counts
 *   and message *length* are logged; never the API key or message content.
 *
 * The agent never invents economics: it edits structured ProposalDraft data
 * through tools and reads numbers back from the deterministic engine.
 */

import type { Message } from "@kenkaiiii/gg-ai";
import {
  isAbortError,
  isBillingError,
  isContextOverflow,
  isUsageLimitError,
  type AgentEvent,
  type AgentResult,
} from "@kenkaiiii/gg-agent";
import { logError, logInfo, logWarn } from "../diagnostics/logger.node.js";
import { isProposalProjectVersionConflictError } from "../project/store.node.js";
import type { AgentStreamFrame } from "../ui/lib/types.js";
import type { EnabledAgentConfig } from "./config.node.js";
import { buildProposalAgent, DEFAULT_MAX_TURNS } from "./proposalAgent.node.js";
import { buildSessionSnapshot, type AgentSession } from "./session.node.js";

/** Default ceiling on tool calls the agent may make while answering one prompt. */
export const DEFAULT_MAX_TOOL_CALLS = 48;

/** Per-prompt safety limits for an agent run. */
export interface AgentRunLimits {
  /** Hard cap on assistant turns. */
  readonly maxTurns: number;
  /** Hard cap on tool calls across all turns of one prompt. */
  readonly maxToolCalls: number;
}

export const DEFAULT_AGENT_RUN_LIMITS: AgentRunLimits = {
  maxTurns: DEFAULT_MAX_TURNS,
  maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
};

/** Dual-nature stream: async-iterable of events + thenable for the final result. */
export interface AgentLikeStream extends AsyncIterable<AgentEvent>, PromiseLike<AgentResult> {}

export interface AgentLike {
  prompt(content: string): AgentLikeStream;
  getMessages(): Message[];
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  set_project_inputs: "Setting project inputs",
  patch_prepared_for: "Updating client details",
  patch_details: "Updating proposal details",
  patch_value_proposal: "Updating value proposition",
  set_build_plan: "Setting build plan",
  set_deliverables: "Setting deliverables",
  patch_pricing: "Updating pricing",
  set_terms: "Updating terms",
  set_next_steps: "Setting next steps",
  run_analysis: "Running analysis",
  validate_draft: "Validating draft",
  get_draft_summary: "Reviewing draft",
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name}`;
}

/** Maps one agent event to zero or more client frames, tracking tool names by call id. */
export function eventToFrames(
  event: AgentEvent,
  toolNames: Map<string, string>,
): readonly AgentStreamFrame[] {
  switch (event.type) {
    case "text_delta":
      return [{ type: "text_delta", text: event.text }];
    case "thinking_delta":
      return [{ type: "thinking_delta", text: event.text }];
    case "tool_call_start":
      toolNames.set(event.toolCallId, event.name);
      return [
        {
          type: "tool_start",
          toolCallId: event.toolCallId,
          name: event.name,
          label: toolLabel(event.name),
        },
      ];
    case "tool_call_end":
      return [
        {
          type: "tool_end",
          toolCallId: event.toolCallId,
          name: toolNames.get(event.toolCallId) ?? "",
          summary: typeof event.result === "string" ? event.result : "",
          isError: event.isError,
        },
      ];
    case "error":
      return [errorFrame(event.error)];
    default:
      return [];
  }
}

export function errorFrame(error: unknown): Extract<AgentStreamFrame, { type: "error" }> {
  if (isProposalProjectVersionConflictError(error)) {
    return {
      type: "error",
      code: error.code,
      message: error.message,
      details: projectConflictFrameDetails(error),
      latestProject: error.latestProject,
    };
  }
  if (isAbortError(error)) {
    return { type: "error", code: "aborted", message: "The request was cancelled." };
  }
  if (isBillingError(error)) {
    return {
      type: "error",
      code: "billing",
      message:
        "The model provider reported a billing or quota problem. Check the agent account balance.",
    };
  }
  if (isUsageLimitError(error)) {
    return {
      type: "error",
      code: "usage_limit",
      message: "The model provider's usage window is exhausted. Try again after it resets.",
    };
  }
  if (isContextOverflow(error)) {
    return {
      type: "error",
      code: "context_overflow",
      message: "The conversation grew too long for the model. Start a new session to continue.",
    };
  }
  return {
    type: "error",
    code: "agent_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function projectConflictFrameDetails(error: unknown): readonly string[] {
  if (!isProposalProjectVersionConflictError(error)) return [];
  return [
    `providedBaseVersionId: ${error.providedBaseVersionId}`,
    `latest.currentVersionId: ${error.latestProject.currentVersionId}`,
    `latest.currentVersionNumber: ${error.latestProject.currentVersionNumber}`,
    `latest.updatedAt: ${error.latestProject.updatedAt}`,
    ...(error.latestProject.updatedBy === undefined
      ? []
      : [`latest.updatedBy: ${error.latestProject.updatedBy.displayName}`]),
    "Fetch the latest project state and retry the agent message against the current version.",
  ];
}

function toolLimitFrame(maxToolCalls: number): Extract<AgentStreamFrame, { type: "error" }> {
  return {
    type: "error",
    code: "tool_limit",
    message: `The assistant hit its tool-call limit (${maxToolCalls}) for this turn. Send another message to let it continue.`,
  };
}

export interface StreamProposalAgentFramesOptions {
  readonly stream: AgentLikeStream;
  readonly session: AgentSession;
  readonly limits: AgentRunLimits;
  /** Internal controller used to self-abort the loop when the tool-call cap trips. */
  readonly abort: AbortController;
  /** Optional finalizer that runs after tools finish, before the terminal snapshot is emitted. */
  readonly beforeSnapshot?: () => Promise<void> | void;
}

/**
 * Translate the agent's event stream into client frames while enforcing the
 * tool-call cap. Pure async generator over an injected stream so it can be
 * unit-tested with a fake AgentStream. Always ends with a source-of-truth
 * snapshot frame followed by a terminal `done` or `error` frame.
 */
export async function* streamProposalAgentFrames(
  options: StreamProposalAgentFramesOptions,
): AsyncGenerator<AgentStreamFrame> {
  const { stream, session, limits, abort, beforeSnapshot } = options;
  const toolNames = new Map<string, string>();
  let toolCalls = 0;
  let toolLimitHit = false;
  let snapshotPrepared = false;

  async function snapshotFrame(): Promise<Extract<AgentStreamFrame, { type: "snapshot" }>> {
    if (!snapshotPrepared && beforeSnapshot !== undefined) {
      snapshotPrepared = true;
      await beforeSnapshot();
    }
    return { type: "snapshot", snapshot: buildSessionSnapshot(session) };
  }

  try {
    for await (const event of stream) {
      if (event.type === "tool_call_start") {
        toolCalls += 1;
        if (toolCalls > limits.maxToolCalls) {
          toolLimitHit = true;
          logWarn("scopeforge.agent.tool_limit_exceeded", {
            sessionId: session.id,
            toolCalls,
            maxToolCalls: limits.maxToolCalls,
          });
          abort.abort();
          break;
        }
      }
      if (event.type === "error") {
        logError("scopeforge.agent.event_error", event.error, { sessionId: session.id });
      }
      for (const frame of eventToFrames(event, toolNames)) yield frame;
    }

    if (toolLimitHit) {
      // The aborted prompt rejects its result promise separately from the
      // iterator; observe it so it cannot surface as an unhandled rejection.
      await Promise.resolve(stream).catch(() => undefined);
      yield await snapshotFrame();
      yield toolLimitFrame(limits.maxToolCalls);
      return;
    }

    const result = await stream;
    yield await snapshotFrame();
    yield { type: "done", totalTurns: result.totalTurns };
  } catch (error) {
    // AgentStream rejects its result promise separately from the async iterator.
    // Once iteration has started the stream is already drained, so observing it
    // here only attaches a handler — preventing an unhandled rejection crash
    // without stealing events from the loop above.
    await Promise.resolve(stream).catch(() => undefined);
    const frame = errorFrame(error);
    if (toolLimitHit && frame.code === "aborted") {
      yield await snapshotFrame();
      yield toolLimitFrame(limits.maxToolCalls);
      return;
    }
    logError("scopeforge.agent.stream_failed", error, { sessionId: session.id });
    yield await snapshotFrame();
    yield frame;
  }
}

/**
 * Backward-compatible translator with default limits and a throwaway controller.
 * Prefer {@link runProposalAgentStream}, which wires real limits and abort.
 */
export function translateAgentStream(
  stream: AgentLikeStream,
  session: AgentSession,
): AsyncGenerator<AgentStreamFrame> {
  return streamProposalAgentFrames({
    stream,
    session,
    limits: DEFAULT_AGENT_RUN_LIMITS,
    abort: new AbortController(),
  });
}

export interface RunProposalAgentStreamOptions {
  readonly config: EnabledAgentConfig;
  readonly session: AgentSession;
  readonly message: string;
  /** External cancellation signal (e.g. client disconnect). */
  readonly signal: AbortSignal;
  /** Override the default turn/tool-call limits. */
  readonly limits?: AgentRunLimits;
  /** Prior conversation (excluding system) for session resume. */
  readonly priorMessages?: Message[];
  /** Known vendor/client context appended to the system prompt. */
  readonly contextNote?: string;
  /** Optional finalizer that persists the mutated session before the terminal snapshot is emitted. */
  readonly beforeSnapshot?: () => Promise<void> | void;
}

/**
 * Run one prompt end-to-end against the session's draft and stream client frames.
 *
 * Builds the agent, chains the caller's AbortSignal to an internal controller (so
 * the tool-call cap can self-abort), enforces both limits, persists the resulting
 * message history on the session, and logs lifecycle records with no secrets.
 */
export async function* runProposalAgentStream(
  options: RunProposalAgentStreamOptions,
): AsyncGenerator<AgentStreamFrame> {
  const limits = options.limits ?? DEFAULT_AGENT_RUN_LIMITS;
  const { session } = options;

  // Chain the external signal to an internal controller. The internal controller
  // is what the loop aborts when the tool-call cap trips, so a limit stop and a
  // user cancellation both flow through one signal.
  const abort = new AbortController();
  const onExternalAbort = (): void => abort.abort();
  if (options.signal.aborted) abort.abort();
  else options.signal.addEventListener("abort", onExternalAbort, { once: true });

  logInfo("scopeforge.agent.run_start", {
    sessionId: session.id,
    provider: options.config.provider,
    model: options.config.model,
    maxTurns: limits.maxTurns,
    maxToolCalls: limits.maxToolCalls,
    resumed: (options.priorMessages?.length ?? 0) > 0,
    // Length only — never the message content or any credential.
    messageChars: options.message.length,
  });

  const agent = buildProposalAgent({
    config: options.config,
    session,
    signal: abort.signal,
    maxTurns: limits.maxTurns,
    ...(options.priorMessages === undefined ? {} : { priorMessages: options.priorMessages }),
    ...(options.contextNote === undefined ? {} : { contextNote: options.contextNote }),
  });

  let totalTurns = 0;
  let terminalCode: string | null = null;
  try {
    const stream = agent.prompt(options.message);
    for await (const frame of streamProposalAgentFrames({
      stream,
      session,
      limits,
      abort,
      ...(options.beforeSnapshot === undefined ? {} : { beforeSnapshot: options.beforeSnapshot }),
    })) {
      if (frame.type === "done") totalTurns = frame.totalTurns;
      if (frame.type === "error") terminalCode = frame.code;
      yield frame;
    }
    // getMessages() includes the system message; strip it so it is not duplicated
    // when the stored history is replayed as priorMessages on the next turn.
    session.messages = agent.getMessages().filter((message) => message.role !== "system");
    if (terminalCode === null) {
      logInfo("scopeforge.agent.run_complete", { sessionId: session.id, totalTurns });
    } else {
      logInfo("scopeforge.agent.run_ended", { sessionId: session.id, code: terminalCode });
    }
  } finally {
    options.signal.removeEventListener("abort", onExternalAbort);
  }
}
