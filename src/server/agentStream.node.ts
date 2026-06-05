import type { IncomingMessage, ServerResponse } from "node:http";
import type { Message } from "@kenkaiiii/gg-ai";
import {
  isAbortError,
  isBillingError,
  isContextOverflow,
  isUsageLimitError,
  type AgentEvent,
  type AgentResult,
} from "@kenkaiiii/gg-agent";
import type { EnabledAgentConfig } from "../agent/config.node.js";
import { logError } from "../diagnostics/logger.node.js";
import { buildProposalAgent } from "../agent/proposalAgent.node.js";
import {
  buildSessionSnapshot,
  resolveSessionBrandId,
  type AgentSession,
  type SessionStore,
} from "../agent/session.node.js";
import type { AgentStreamFrame } from "../ui/lib/types.js";
import type { ProposalAudience } from "../proposal/types.js";

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

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name}`;
}

/**
 * Translate the agent's event stream into client SSE frames. Pure async generator
 * over an injected stream so it can be unit-tested with a fake AgentStream.
 * Pushes a final snapshot frame so the client always ends with the source-of-truth draft.
 */
export async function* translateAgentStream(
  stream: AgentLikeStream,
  session: AgentSession,
): AsyncGenerator<AgentStreamFrame> {
  const toolNames = new Map<string, string>();
  try {
    for await (const event of stream) {
      if (event.type === "error") {
        logError("scopeforge.agent.event_error", event.error, { sessionId: session.id });
      }
      for (const frame of eventToFrames(event, toolNames)) yield frame;
    }
    const result = await stream;
    yield { type: "snapshot", snapshot: buildSessionSnapshot(session) };
    yield { type: "done", totalTurns: result.totalTurns };
  } catch (error) {
    // AgentStream rejects its result promise separately from the async iterator.
    // Once iteration has started the stream is already drained, so observing it
    // here only attaches a handler — preventing an unhandled rejection crash
    // without stealing events from the loop above.
    await Promise.resolve(stream).catch(() => undefined);
    logError("scopeforge.agent.stream_failed", error, { sessionId: session.id });
    yield { type: "snapshot", snapshot: buildSessionSnapshot(session) };
    yield errorFrame(error);
  }
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

export function encodeSseFrame(frame: AgentStreamFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

interface AgentMessageInput {
  readonly sessionId?: string;
  readonly message: string;
  readonly brandId?: string;
  readonly audience?: ProposalAudience;
}

type ParseResult =
  | { readonly ok: true; readonly value: AgentMessageInput }
  | { readonly ok: false; readonly message: string };

export function parseAgentMessageBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const message = record.message;
  if (typeof message !== "string" || message.trim().length === 0) {
    return { ok: false, message: "message must be a non-empty string." };
  }
  const audience =
    record.audience === "internal" || record.audience === "client" ? record.audience : undefined;
  return {
    ok: true,
    value: {
      message: message.trim(),
      ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
      ...(typeof record.brandId === "string" ? { brandId: record.brandId } : {}),
      ...(audience === undefined ? {} : { audience }),
    },
  };
}

export interface AgentStreamHandlerOptions {
  readonly config: EnabledAgentConfig;
  readonly sessions: SessionStore;
}

/**
 * HTTP-level SSE handler for POST /api/agent/messages. Writes an event-stream,
 * persists message history + draft on the session, and maps errors to clean frames.
 */
export async function handleAgentMessages(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  options: AgentStreamHandlerOptions,
): Promise<void> {
  const parsed = parseAgentMessageBody(body);
  if (!parsed.ok) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({ ok: false, error: { code: "bad_request", message: parsed.message } }),
    );
    return;
  }

  const session = options.sessions.getOrCreate(parsed.value.sessionId, {
    ...(parsed.value.brandId === undefined
      ? {}
      : { brandId: resolveSessionBrandId(parsed.value.brandId) }),
    ...(parsed.value.audience === undefined ? {} : { audience: parsed.value.audience }),
  });
  if (parsed.value.brandId !== undefined) {
    session.brandId = resolveSessionBrandId(parsed.value.brandId);
  }
  if (parsed.value.audience !== undefined) session.audience = parsed.value.audience;

  const abort = new AbortController();
  session.abort = abort;
  request.on("aborted", () => abort.abort());
  request.on("close", () => abort.abort());

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accent-Buffering": "no",
  });

  write(response, { type: "session", sessionId: session.id });

  const agent = buildProposalAgent({
    config: options.config,
    session,
    signal: abort.signal,
    ...(session.messages.length > 0 ? { priorMessages: session.messages } : {}),
  });

  try {
    const stream = agent.prompt(parsed.value.message);
    for await (const frame of translateAgentStream(stream, session)) {
      write(response, frame);
    }
    // getMessages() includes the system message; strip it so it is not duplicated
    // when the stored history is replayed as priorMessages on the next turn.
    session.messages = agent.getMessages().filter((message) => message.role !== "system");
  } catch (error) {
    logError("scopeforge.agent.request_failed", error, { sessionId: session.id });
    write(response, errorFrame(error));
  } finally {
    session.abort = null;
    response.end();
  }
}

function write(response: ServerResponse, frame: AgentStreamFrame): void {
  response.write(encodeSseFrame(frame));
}
