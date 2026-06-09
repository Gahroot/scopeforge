import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProposalProjectId } from "../project/types.js";
import {
  type ShareToken,
  type ShareTokenAnalytics,
  type ShareTokenStore,
} from "../project/shareStore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EngagementEventType =
  | "viewed"
  | "section_view"
  | "pricing_focus"
  | "time_on_page";

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

export function validateEngagementEvent(
  input: unknown,
): { readonly ok: true; readonly value: EngagementEvent } | { readonly ok: false; readonly error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Event body must be a JSON object." };
  }
  const obj = input as Record<string, unknown>;

  if (typeof obj.event !== "string" || !VALID_EVENT_TYPES.includes(obj.event as EngagementEventType)) {
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
        ? obj.section.trim()
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
        ? obj.viewerId.trim()
        : undefined;

  return {
    ok: true,
    value: {
      event: obj.event as EngagementEventType,
      ts: obj.ts.trim(),
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
}

export class EngagementTracker {
  private readonly dataDir: string;

  constructor(options: EngagementTrackerOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? ".scopeforge/share");
  }

  private eventsDir(token: ShareToken): string {
    return join(this.dataDir, String(token));
  }

  private eventsPath(token: ShareToken): string {
    return join(this.eventsDir(token), "events.json");
  }

  async record(token: ShareToken, event: EngagementEvent): Promise<void> {
    const dir = this.eventsDir(token);
    await mkdir(dir, { recursive: true });
    const filePath = this.eventsPath(token);

    let existing: EngagementEvent[];
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      existing = Array.isArray(parsed) ? (parsed as EngagementEvent[]) : [];
    } catch {
      existing = [];
    }

    existing.push(event);
    await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
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
