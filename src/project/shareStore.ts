import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProposalProjectId, ProposalProjectVersionId } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShareToken = string & { readonly __brand: "ShareToken" };

export interface ShareTokenRecord {
  readonly token: ShareToken;
  readonly projectId: ProposalProjectId;
  readonly versionId: ProposalProjectVersionId;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface ShareTokenAnalytics {
  readonly views: number;
  readonly uniqueViewers: number;
  readonly sectionEngagement: Readonly<Record<string, number>>;
  readonly pricingFocusCount: number;
  readonly lastViewed: string | null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const DEFAULT_SHARE_DATA_DIR = ".scopeforge/share";

export interface ShareTokenStoreOptions {
  readonly dataDir?: string;
  readonly now?: () => Date;
}

export class ShareTokenStore {
  private readonly dataDir: string;
  private readonly now: () => Date;
  private tokensByValue = new Map<ShareToken, ShareTokenRecord>();
  private tokensByProject = new Map<ProposalProjectId, Set<ShareToken>>();

  constructor(options: ShareTokenStoreOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? DEFAULT_SHARE_DATA_DIR);
    this.now = options.now ?? (() => new Date());
  }

  async load(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const filePath = join(this.dataDir, "tokens.json");
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (!isShareTokenRecord(entry)) continue;
        this.tokensByValue.set(entry.token, entry);
        const projectTokens = this.tokensByProject.get(entry.projectId);
        if (projectTokens !== undefined) {
          projectTokens.add(entry.token);
        } else {
          this.tokensByProject.set(entry.projectId, new Set([entry.token]));
        }
      }
    } catch {
      // Corrupted file — start fresh.
    }
  }

  create(
    projectId: ProposalProjectId,
    versionId: ProposalProjectVersionId,
    expiresAt?: string,
  ): ShareTokenRecord {
    const token = toShareToken(randomUUID());
    const now = this.now().toISOString();
    const record: ShareTokenRecord = {
      token,
      projectId,
      versionId,
      createdAt: now,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
    this.tokensByValue.set(token, record);
    const projectTokens = this.tokensByProject.get(projectId);
    if (projectTokens !== undefined) {
      projectTokens.add(token);
    } else {
      this.tokensByProject.set(projectId, new Set([token]));
    }
    return record;
  }

  get(token: ShareToken): ShareTokenRecord | null {
    const record = this.tokensByValue.get(token);
    if (record === undefined) return null;
    if (record.expiresAt !== undefined) {
      if (new Date(record.expiresAt) < this.now()) return null;
    }
    return record;
  }

  listForProject(projectId: ProposalProjectId): readonly ShareTokenRecord[] {
    const tokenSet = this.tokensByProject.get(projectId);
    if (tokenSet === undefined) return [];
    const records: ShareTokenRecord[] = [];
    for (const token of tokenSet) {
      const record = this.tokensByValue.get(token);
      if (record !== undefined) records.push(record);
    }
    return records;
  }

  async persist(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const records = [...this.tokensByValue.values()];
    const filePath = join(this.dataDir, "tokens.json");
    const payload = `${JSON.stringify(records, null, 2)}\n`;
    await writeFile(filePath, payload, "utf8");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toShareToken(input: string): ShareToken {
  return input as ShareToken;
}

function isShareTokenRecord(input: unknown): input is ShareTokenRecord {
  if (typeof input !== "object" || input === null) return false;
  const obj = input as Record<string, unknown>;
  return (
    typeof obj.token === "string" &&
    typeof obj.projectId === "string" &&
    typeof obj.versionId === "string" &&
    typeof obj.createdAt === "string"
  );
}
