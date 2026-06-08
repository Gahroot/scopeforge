import type { IncomingMessage, ServerResponse } from "node:http";
import type { EnabledAgentConfig } from "../agent/config.node.js";
import { logError, logWarn } from "../diagnostics/logger.node.js";
import { errorFrame, runProposalAgentStream } from "../agent/proposalAgentService.node.js";
import {
  DEFAULT_SESSION_AUTHOR,
  applyClientBrandToSession,
  applyProjectContextToSession,
  buildSessionProjectSourceOfTruth,
  resolveSessionBrandId,
  type AgentSession,
  type SessionProjectContext,
  type SessionStore,
} from "../agent/session.node.js";
import {
  createProposalAuthorMetadata,
  getCurrentProjectVersion,
  toProposalProjectId,
  toProposalProjectVersionId,
} from "../project/state.js";
import {
  ProposalProjectVersionConflictError,
  createLocalProposalProjectStore,
  projectConflictMetadata,
  type ProposalProjectConflictMetadata,
  type ProposalProjectStoreLoadResult,
} from "../project/store.node.js";
import type {
  CommitProposalProjectVersionInput,
  ProposalAuthorKind,
  ProposalAuthorMetadata,
  ProposalProject,
  ProposalProjectId,
  ProposalProjectVersion,
  ProposalProjectVersionId,
} from "../project/types.js";
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
  readonly projectId?: ProposalProjectId;
  readonly baseVersion?: ProposalProjectVersionId;
  readonly newChatFromLatestProject?: boolean;
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

export interface AgentProposalProjectStore {
  readonly load?: () => Promise<ProposalProjectStoreLoadResult>;
  readonly get: (projectId: ProposalProjectId) => ProposalProject | null;
  readonly update?: (
    projectId: ProposalProjectId,
    input: CommitProposalProjectVersionInput,
  ) => Promise<ProposalProject | null>;
}

export function parseAgentMessageBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const message = record.message;
  if (typeof message !== "string" || message.trim().length === 0) {
    return { ok: false, message: "message must be a non-empty string." };
  }
  const projectId =
    typeof record.projectId === "string" && record.projectId.trim().length > 0
      ? toProposalProjectId(record.projectId.trim())
      : undefined;
  const newChatFromLatestProject = record.newChatFromLatestProject === true;
  const baseVersion = parseOptionalBaseVersion(record);
  if (!baseVersion.ok) return { ok: false, message: baseVersion.message };
  if (newChatFromLatestProject && projectId === undefined) {
    return { ok: false, message: "newChatFromLatestProject requires projectId." };
  }
  if (baseVersion.value !== undefined && projectId === undefined) {
    return { ok: false, message: "baseVersion requires projectId." };
  }
  if (projectId !== undefined && baseVersion.value === undefined && !newChatFromLatestProject) {
    return { ok: false, message: "projectId requires baseVersion." };
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
      ...(!newChatFromLatestProject && typeof record.sessionId === "string"
        ? { sessionId: record.sessionId }
        : {}),
      ...(projectId === undefined ? {} : { projectId }),
      ...(baseVersion.value === undefined || newChatFromLatestProject
        ? {}
        : { baseVersion: baseVersion.value }),
      ...(newChatFromLatestProject ? { newChatFromLatestProject: true } : {}),
      ...(typeof record.brandId === "string" ? { brandId: record.brandId } : {}),
      ...(audience === undefined ? {} : { audience }),
      ...(author.value === undefined ? {} : { author: author.value }),
      ...(vendorBrand === undefined ? {} : { vendorBrand }),
      ...(clientBrand === undefined ? {} : { clientBrand }),
    },
  };
}

function parseOptionalBaseVersion(
  record: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly value?: ProposalProjectVersionId }
  | { readonly ok: false; readonly message: string } {
  const rawBaseVersion = record.baseVersion ?? record.baseVersionId;
  if (rawBaseVersion === undefined || rawBaseVersion === null) return { ok: true };
  if (typeof rawBaseVersion !== "string" || rawBaseVersion.trim().length === 0) {
    return { ok: false, message: "baseVersion must be a non-empty string when provided." };
  }
  return { ok: true, value: toProposalProjectVersionId(rawBaseVersion.trim()) };
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

interface ResolvedProjectContext {
  readonly store: AgentProposalProjectStore;
  readonly project: ProposalProject;
  readonly currentVersion: ProposalProjectVersion;
  readonly sessionContext: SessionProjectContext;
}

type ProjectContextResult =
  | { readonly ok: true; readonly value?: ResolvedProjectContext }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details?: readonly string[];
        readonly latestProject?: ProposalProjectConflictMetadata;
      };
    };

interface ResolveSelectedProjectContextOptions {
  readonly proposalProjectStore?: AgentProposalProjectStore;
  readonly acceptLatestProject: boolean;
  readonly requireWritableStore: boolean;
}

async function resolveSelectedProjectContext(
  projectId: ProposalProjectId | undefined,
  baseVersion: ProposalProjectVersionId | undefined,
  options: ResolveSelectedProjectContextOptions,
): Promise<ProjectContextResult> {
  if (projectId === undefined) return { ok: true };

  const store = options.proposalProjectStore ?? createLocalProposalProjectStore();
  if (options.requireWritableStore && store.update === undefined) {
    return {
      ok: false,
      status: 503,
      error: {
        code: "project_store_update_unavailable",
        message: "Proposal project storage cannot save agent changes.",
      },
    };
  }
  if (store.load !== undefined) {
    try {
      const load = await store.load();
      if (!load.ok) {
        return {
          ok: false,
          status: 503,
          error: {
            code: "project_store_load_failed",
            message: "Proposal project storage could not be loaded safely.",
            details: projectStoreLoadDetails(load),
          },
        };
      }
    } catch (error) {
      return {
        ok: false,
        status: 503,
        error: {
          code: "project_store_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  const project = store.get(projectId);
  if (project === null) {
    return {
      ok: false,
      status: 404,
      error: {
        code: "project_not_found",
        message: `Proposal project was not found: ${projectId}.`,
      },
    };
  }

  const version = getCurrentProjectVersion(project);
  if (version === null) {
    return {
      ok: false,
      status: 500,
      error: {
        code: "project_state_invalid",
        message: "Proposal project currentVersionId does not reference a stored version.",
      },
    };
  }

  if (!options.acceptLatestProject && baseVersion !== version.versionId) {
    const latestProject = projectConflictMetadata(project);
    return {
      ok: false,
      status: 409,
      error: {
        code: "base_version_conflict",
        message: "Project has changed since the provided baseVersion.",
        details: [
          `providedBaseVersionId: ${baseVersion}`,
          `latest.currentVersionId: ${latestProject.currentVersionId}`,
          `latest.currentVersionNumber: ${latestProject.currentVersionNumber}`,
          `latest.updatedAt: ${latestProject.updatedAt}`,
          "Fetch the latest project state and retry the agent message against the current version.",
        ],
        latestProject,
      },
    };
  }

  return {
    ok: true,
    value: {
      store,
      project,
      currentVersion: version,
      sessionContext: {
        projectId: project.projectId,
        versionId: version.versionId,
        sourceOfTruth: version.sourceOfTruth,
      },
    },
  };
}

function projectStoreLoadDetails(load: ProposalProjectStoreLoadResult): readonly string[] {
  if (load.ok) return [];
  return load.errors.map((error) => `${error.code}: ${error.path}: ${error.message}`);
}

export interface AgentStreamHandlerOptions {
  readonly config: EnabledAgentConfig;
  readonly sessions: SessionStore;
  readonly proposalProjectStore?: AgentProposalProjectStore;
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

  const resolvedProject = await resolveSelectedProjectContext(
    parsed.value.projectId,
    parsed.value.baseVersion,
    {
      ...(options.proposalProjectStore === undefined
        ? {}
        : { proposalProjectStore: options.proposalProjectStore }),
      acceptLatestProject: parsed.value.newChatFromLatestProject === true,
      requireWritableStore: true,
    },
  );
  if (!resolvedProject.ok) {
    response.writeHead(resolvedProject.status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ ok: false, error: resolvedProject.error }));
    return;
  }

  const projectContext = resolvedProject.value?.sessionContext;
  const session = options.sessions.getOrCreate(parsed.value.sessionId, {
    ...(parsed.value.brandId === undefined
      ? {}
      : { brandId: resolveSessionBrandId(parsed.value.brandId) }),
    ...(parsed.value.audience === undefined ? {} : { audience: parsed.value.audience }),
    ...(parsed.value.author === undefined ? {} : { author: parsed.value.author }),
    ...(projectContext === undefined ? {} : { projectContext }),
  });
  if (projectContext !== undefined) {
    const shouldHydrateFromProject =
      parsed.value.newChatFromLatestProject === true ||
      session.projectId !== projectContext.projectId ||
      session.projectVersionId !== projectContext.versionId;
    if (shouldHydrateFromProject) {
      applyProjectContextToSession(session, projectContext);
      session.messages = [];
    }
  }
  if (parsed.value.brandId !== undefined) {
    session.brandId = resolveSessionBrandId(parsed.value.brandId);
  }
  if (parsed.value.audience !== undefined) session.audience = parsed.value.audience;
  if (parsed.value.author !== undefined) session.createdBy = parsed.value.author;
  if (projectContext === undefined) {
    if (parsed.value.vendorBrand !== undefined) session.vendorBrand = parsed.value.vendorBrand;
    if (
      parsed.value.clientBrand !== undefined &&
      parsed.value.clientBrand.id !== session.clientBrand?.id
    ) {
      applyClientBrandToSession(session, parsed.value.clientBrand);
    }
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
  const projectPersistenceContext = resolvedProject.value;
  const priorMessages = session.messages.length > 0 ? session.messages : undefined;
  const persistProjectVersion =
    projectPersistenceContext === undefined
      ? undefined
      : () => persistProjectBackedAgentSession(session, projectPersistenceContext);
  try {
    for await (const frame of runProposalAgentStream({
      config: options.config,
      session,
      message: parsed.value.message,
      signal: abort.signal,
      ...(priorMessages === undefined ? {} : { priorMessages }),
      ...(contextNote === undefined ? {} : { contextNote }),
      ...(persistProjectVersion === undefined ? {} : { beforeSnapshot: persistProjectVersion }),
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

async function persistProjectBackedAgentSession(
  session: AgentSession,
  projectContext: ResolvedProjectContext,
): Promise<void> {
  const sourceOfTruth = buildSessionProjectSourceOfTruth(session);
  if (sourceOfTruth === null) {
    throw new Error("Cannot save a project-backed agent session without vendor and client brands.");
  }

  const latestProject = projectContext.store.get(projectContext.project.projectId);
  if (latestProject === null) {
    throw new Error(
      `Proposal project was not found while saving: ${projectContext.project.projectId}.`,
    );
  }
  if (latestProject.currentVersionId !== projectContext.currentVersion.versionId) {
    throw new ProposalProjectVersionConflictError({
      project: latestProject,
      providedBaseVersionId: projectContext.currentVersion.versionId,
      message: `Project changed while the agent was responding. Current version is ${latestProject.currentVersionId}; retry against the latest project state.`,
    });
  }

  const update = projectContext.store.update;
  if (update === undefined) {
    throw new Error("Proposal project storage cannot save agent changes.");
  }

  const updated = await update(projectContext.project.projectId, {
    sourceOfTruth,
    createdBy: session.createdBy,
    parentVersionId: projectContext.currentVersion.versionId,
    source: "agent-edit",
    label: "Agent proposal update",
  });
  if (updated === null) {
    throw new Error(
      `Proposal project was not found while saving: ${projectContext.project.projectId}.`,
    );
  }

  const version = getCurrentProjectVersion(updated);
  if (version === null) {
    throw new Error("Saved proposal project currentVersionId does not reference a stored version.");
  }
  applyProjectContextToSession(session, {
    projectId: updated.projectId,
    versionId: version.versionId,
    sourceOfTruth: version.sourceOfTruth,
  });
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
