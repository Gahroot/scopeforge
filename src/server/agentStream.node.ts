import type { IncomingMessage, ServerResponse } from "node:http";
import type { EnabledAgentConfig } from "../agent/config.node.js";
import { logError, logWarn } from "../diagnostics/logger.node.js";
import { errorFrame, runProposalAgentStream } from "../agent/proposalAgentService.node.js";
import {
  DEFAULT_SESSION_AUTHOR,
  applyClientBrandToSession,
  resolveSessionBrandId,
  type AgentSession,
  type SessionStore,
} from "../agent/session.node.js";
import { createProposalAuthorMetadata } from "../project/state.js";
import type { ProposalAuthorKind, ProposalAuthorMetadata } from "../project/types.js";
import { validateProposalBrand } from "../proposal/brands.js";
import type { AgentStreamFrame } from "../ui/lib/types.js";
import type { ProposalAudience, ProposalBrand } from "../proposal/types.js";

// Streaming translation, limits, and event mapping live in the agent runtime
// (src/agent/proposalAgentService.node.ts). Re-exported here so existing
// importers and tests keep their entry point.
export {
  errorFrame,
  eventToFrames,
  translateAgentStream,
  type AgentLike,
  type AgentLikeStream,
} from "../agent/proposalAgentService.node.js";

export function encodeSseFrame(frame: AgentStreamFrame): string {
  return `data: ${JSON.stringify(frame)}\n\n`;
}

interface AgentMessageInput {
  readonly sessionId?: string;
  readonly message: string;
  readonly brandId?: string;
  readonly audience?: ProposalAudience;
  readonly author?: ProposalAuthorMetadata;
  readonly vendorBrand?: ProposalBrand;
  readonly clientBrand?: ProposalBrand;
}

/**
 * Validate an optional imported brand from the request body. A malformed brand is
 * dropped (returns undefined) and logged — chat must never hard-fail on a bad brand.
 */
function parseOptionalBrand(value: unknown, role: "vendor" | "client"): ProposalBrand | undefined {
  if (value === undefined || value === null) return undefined;
  const result = validateProposalBrand(value);
  if (result.ok) return result.value;
  logWarn("scopeforge.agent.invalid_brand", {
    role,
    errors: result.errors.map((error) => `${error.path}: ${error.message}`),
  });
  return undefined;
}

const AGENT_AUTHOR_KINDS = [
  "human",
  "agent",
  "system",
] as const satisfies readonly ProposalAuthorKind[];

type AgentAuthorParseResult =
  | { readonly ok: true; readonly value?: ProposalAuthorMetadata }
  | { readonly ok: false; readonly message: string };

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
  const author = parseOptionalAgentAuthor(record);
  if (!author.ok) return { ok: false, message: author.message };
  const vendorBrand = parseOptionalBrand(record.vendorBrand, "vendor");
  const clientBrand = parseOptionalBrand(record.clientBrand, "client");
  return {
    ok: true,
    value: {
      message: message.trim(),
      ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
      ...(typeof record.brandId === "string" ? { brandId: record.brandId } : {}),
      ...(audience === undefined ? {} : { audience }),
      ...(author.value === undefined ? {} : { author: author.value }),
      ...(vendorBrand === undefined ? {} : { vendorBrand }),
      ...(clientBrand === undefined ? {} : { clientBrand }),
    },
  };
}

function parseOptionalAgentAuthor(
  record: Readonly<Record<string, unknown>>,
): AgentAuthorParseResult {
  const rawAuthor =
    record.createdBy ??
    record.updatedBy ??
    record.author ??
    record.displayName ??
    record.authorDisplayName;
  if (rawAuthor === undefined || rawAuthor === null) return { ok: true };

  if (typeof rawAuthor === "string") {
    const displayName = rawAuthor.trim();
    if (displayName.length === 0) {
      return {
        ok: false,
        message: "author/displayName must be a non-empty string when provided.",
      };
    }
    return {
      ok: true,
      value: createProposalAuthorMetadata({
        authorId: slugifyAuthorId(displayName),
        displayName,
        kind: "human",
      }),
    };
  }

  if (!isRecord(rawAuthor)) {
    return { ok: false, message: "author must be a display name or author metadata." };
  }

  const errors: string[] = [];
  const authorId = readRequiredAgentAuthorString(rawAuthor, "authorId", errors);
  const displayName = readRequiredAgentAuthorString(rawAuthor, "displayName", errors);
  const kind = readRequiredAgentAuthorKind(rawAuthor.kind, errors);
  const email = readOptionalAgentAuthorString(rawAuthor, "email", errors);
  const organization = readOptionalAgentAuthorString(rawAuthor, "organization", errors);

  if (errors.length > 0 || authorId === null || displayName === null || kind === null) {
    return { ok: false, message: `Author metadata is invalid: ${errors.join("; ")}` };
  }

  return {
    ok: true,
    value: createProposalAuthorMetadata({
      authorId,
      displayName,
      kind,
      ...(email === undefined ? {} : { email }),
      ...(organization === undefined ? {} : { organization }),
    }),
  };
}

function readRequiredAgentAuthorString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  errors: string[],
): string | null {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function readOptionalAgentAuthorString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  errors: string[],
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key} must be a non-empty string when provided`);
    return undefined;
  }
  return value.trim();
}

function readRequiredAgentAuthorKind(input: unknown, errors: string[]): ProposalAuthorKind | null {
  if (isAgentAuthorKind(input)) return input;
  errors.push(`kind must be one of: ${AGENT_AUTHOR_KINDS.join(", ")}`);
  return null;
}

function isAgentAuthorKind(input: unknown): input is ProposalAuthorKind {
  return typeof input === "string" && AGENT_AUTHOR_KINDS.some((kind) => kind === input);
}

function slugifyAuthorId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? "local-collaborator" : slug;
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
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
    ...(parsed.value.author === undefined ? {} : { author: parsed.value.author }),
  });
  if (parsed.value.brandId !== undefined) {
    session.brandId = resolveSessionBrandId(parsed.value.brandId);
  }
  if (parsed.value.audience !== undefined) session.audience = parsed.value.audience;
  if (parsed.value.author !== undefined) session.createdBy = parsed.value.author;
  if (parsed.value.vendorBrand !== undefined) session.vendorBrand = parsed.value.vendorBrand;
  if (
    parsed.value.clientBrand !== undefined &&
    parsed.value.clientBrand.id !== session.clientBrand?.id
  ) {
    applyClientBrandToSession(session, parsed.value.clientBrand);
  }

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

  write(response, {
    type: "session",
    sessionId: session.id,
    author: session.createdBy ?? DEFAULT_SESSION_AUTHOR,
  });

  const contextNote = buildContextNote(session);
  try {
    for await (const frame of runProposalAgentStream({
      config: options.config,
      session,
      message: parsed.value.message,
      signal: abort.signal,
      ...(session.messages.length > 0 ? { priorMessages: session.messages } : {}),
      ...(contextNote === undefined ? {} : { contextNote }),
    })) {
      write(response, frame);
    }
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

/**
 * Build a "Known context" note from imported vendor/client brands so the agent
 * does not re-ask for identity it already has. Returns undefined when nothing is known.
 */
function buildContextNote(session: AgentSession): string | undefined {
  const lines: string[] = [];
  if (session.vendorBrand !== null) {
    const vendor = session.vendorBrand;
    const tagline = vendor.tagline === undefined ? "" : ` — ${vendor.tagline}`;
    lines.push(`- Vendor (the consultant / "My brand"): ${vendor.name}${tagline}.`);
  }
  if (session.clientBrand !== null) {
    const client = session.clientBrand;
    const website = client.website === undefined ? "" : ` (${client.website})`;
    lines.push(`- Client (who the proposal is for): ${client.name}${website}.`);
  }
  if (lines.length === 0) return undefined;
  return [
    "Known context (already imported — do NOT re-ask for these):",
    ...lines,
    "Use these facts directly and move on to the project goal, scope, value, and pricing.",
  ].join("\n");
}
