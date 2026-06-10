import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ProposalProjectId } from "../project/types.js";
import type { ShareToken, ShareTokenAnalytics, ShareTokenStore } from "../project/shareStore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EngagementEventType = "viewed" | "section_view" | "pricing_focus" | "time_on_page";

export interface EngagementEvent {
  readonly event: EngagementEventType;
  readonly section?: string;
  readonly duration?: number;
  readonly ts: string;
  readonly viewerId?: string;
}

// ---------------------------------------------------------------------------
// Zod-free input validation (keeps external-dep constraint)
// ---------------------------------------------------------------------------

const VALID_EVENT_TYPES: readonly EngagementEventType[] = [
  "viewed",
  "section_view",
  "pricing_focus",
  "time_on_page",
];

/** Hard cap on every string field of a beacon event (ts/section/viewerId). */
export const MAX_ENGAGEMENT_STRING_CHARS = 200;

/** Hard cap on stored events per share token; oldest events are dropped first. */
export const MAX_ENGAGEMENT_EVENTS_PER_TOKEN = 5000;

function capString(value: string): string {
  return value.length > MAX_ENGAGEMENT_STRING_CHARS
    ? value.slice(0, MAX_ENGAGEMENT_STRING_CHARS)
    : value;
}

export function validateEngagementEvent(
  input: unknown,
):
  | { readonly ok: true; readonly value: EngagementEvent }
  | { readonly ok: false; readonly error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Event body must be a JSON object." };
  }
  const obj = input as Record<string, unknown>;

  if (
    typeof obj.event !== "string" ||
    !VALID_EVENT_TYPES.includes(obj.event as EngagementEventType)
  ) {
    return {
      ok: false,
      error: `event must be one of: ${VALID_EVENT_TYPES.join(", ")}.`,
    };
  }
  if (typeof obj.ts !== "string" || obj.ts.trim().length === 0) {
    return { ok: false, error: "ts must be a non-empty ISO timestamp string." };
  }

  const section =
    obj.section === undefined || obj.section === null
      ? undefined
      : typeof obj.section === "string"
        ? capString(obj.section.trim())
        : undefined;
  const duration =
    obj.duration === undefined || obj.duration === null
      ? undefined
      : typeof obj.duration === "number" && Number.isFinite(obj.duration) && obj.duration >= 0
        ? obj.duration
        : undefined;
  const viewerId =
    obj.viewerId === undefined || obj.viewerId === null
      ? undefined
      : typeof obj.viewerId === "string" && obj.viewerId.trim().length > 0
        ? capString(obj.viewerId.trim())
        : undefined;

  return {
    ok: true,
    value: {
      event: obj.event as EngagementEventType,
      ts: capString(obj.ts.trim()),
      ...(section === undefined ? {} : { section }),
      ...(duration === undefined ? {} : { duration }),
      ...(viewerId === undefined ? {} : { viewerId }),
    },
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface EngagementTrackerOptions {
  readonly dataDir?: string;
  /** Maximum stored events per token; oldest are dropped. Defaults to 5000. */
  readonly maxEventsPerToken?: number;
}

export class EngagementTracker {
  private readonly dataDir: string;
  private readonly maxEventsPerToken: number;
  /** Per-token tail of the in-process write queue; serializes record() calls. */
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(options: EngagementTrackerOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? ".scopeforge/share");
    this.maxEventsPerToken = options.maxEventsPerToken ?? MAX_ENGAGEMENT_EVENTS_PER_TOKEN;
  }

  private eventsDir(token: ShareToken): string {
    return join(this.dataDir, String(token));
  }

  private eventsPath(token: ShareToken): string {
    return join(this.eventsDir(token), "events.json");
  }

  async record(token: ShareToken, event: EngagementEvent): Promise<void> {
    const key = String(token);
    const previous = this.writeQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.appendEvent(token, event));
    this.writeQueues.set(key, next);
    try {
      await next;
    } finally {
      if (this.writeQueues.get(key) === next) this.writeQueues.delete(key);
    }
  }

  private async appendEvent(token: ShareToken, event: EngagementEvent): Promise<void> {
    const dir = this.eventsDir(token);
    await mkdir(dir, { recursive: true });
    const filePath = this.eventsPath(token);

    const existing = await this.loadEventsForAppend(filePath);
    existing.push(event);
    const capped =
      existing.length > this.maxEventsPerToken
        ? existing.slice(existing.length - this.maxEventsPerToken)
        : existing;
    await writeJsonFileAtomic(filePath, capped);
  }

  /**
   * Read the current events for appending. A missing file starts fresh; a file
   * that no longer parses (e.g. torn by an external writer) is preserved by
   * renaming it aside rather than wiping the history.
   */
  private async loadEventsForAppend(filePath: string): Promise<EngagementEvent[]> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as EngagementEvent[]) : [];
    } catch {
      await rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined);
      return [];
    }
  }

  async readEvents(token: ShareToken): Promise<readonly EngagementEvent[]> {
    const filePath = this.eventsPath(token);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as EngagementEvent[]) : [];
    } catch {
      return [];
    }
  }

  async getAnalytics(
    projectId: ProposalProjectId,
    shareStore: ShareTokenStore,
  ): Promise<ShareTokenAnalytics> {
    const tokens = shareStore.listForProject(projectId);
    let totalViews = 0;
    const uniqueViewerIds = new Set<string>();
    const sectionEngagement: Record<string, number> = {};
    let pricingFocusCount = 0;
    let lastViewed: string | null = null;

    for (const tokenRecord of tokens) {
      const events = await this.readEvents(tokenRecord.token);
      for (const event of events) {
        if (event.event === "viewed") {
          totalViews += 1;
          if (event.viewerId !== undefined) uniqueViewerIds.add(event.viewerId);
          if (event.ts > (lastViewed ?? "")) lastViewed = event.ts;
        }
        if (event.event === "section_view" && event.section !== undefined) {
          sectionEngagement[event.section] = (sectionEngagement[event.section] ?? 0) + 1;
          if (event.viewerId !== undefined) uniqueViewerIds.add(event.viewerId);
          if (event.ts > (lastViewed ?? "")) lastViewed = event.ts;
        }
        if (event.event === "pricing_focus") {
          pricingFocusCount += 1;
          if (event.viewerId !== undefined) uniqueViewerIds.add(event.viewerId);
          if (event.ts > (lastViewed ?? "")) lastViewed = event.ts;
        }
        if (event.event === "time_on_page") {
          if (event.viewerId !== undefined) uniqueViewerIds.add(event.viewerId);
          if (event.ts > (lastViewed ?? "")) lastViewed = event.ts;
        }
      }
    }

    return {
      views: totalViews,
      uniqueViewers: uniqueViewerIds.size,
      sectionEngagement,
      pricingFocusCount,
      lastViewed,
    };
  }
}

/**
 * Write JSON via a temp file + rename so readers never observe a torn write.
 * Mirrors writeJsonFileAtomic in src/project/store.node.ts (not exported there).
 */
async function writeJsonFileAtomic(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const tempPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(tempPath, "wx");
  let renameComplete = false;
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    await rename(tempPath, path);
    renameComplete = true;
  } finally {
    if (!renameComplete) {
      await handle.close().catch(() => undefined);
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
