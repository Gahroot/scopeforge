const STORAGE_KEY = "scopeforge.projects";

export interface SavedProjectEntry {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  readonly json: string;
  readonly kind: "intake" | "draft";
  readonly templateId?: string;
  readonly brandId?: string;
}

export type LocalProjectList = readonly SavedProjectEntry[];

export function loadLocalProjects(): LocalProjectList {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedProjectEntry);
  } catch {
    return [];
  }
}

export function saveLocalProject(entry: SavedProjectEntry): LocalProjectList {
  const existing = loadLocalProjects().filter((item) => item.id !== entry.id);
  const updated = [entry, ...existing].slice(0, 50);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage full — silent fallback
  }
  return updated;
}

export function deleteLocalProject(id: string): LocalProjectList {
  const updated = loadLocalProjects().filter((item) => item.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // silent fallback
  }
  return updated;
}

export function generateProjectId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `proj-${timestamp}-${random}`;
}

function isSavedProjectEntry(input: unknown): input is SavedProjectEntry {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const record = input as Readonly<Record<string, unknown>>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.name === "string" &&
    record.name.length > 0 &&
    typeof record.savedAt === "string" &&
    typeof record.json === "string"
  );
}
