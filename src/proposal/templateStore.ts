import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProposalDraft, ProposalTemplate, ProposalTemplateWithDraft } from "./types.js";
import { validateProposalDraft } from "./schema.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUILT_IN_TEMPLATES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "templates",
);

const DEFAULT_CUSTOM_TEMPLATES_DIR = ".scopeforge/templates";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TemplateStoreOptions {
  readonly builtInDir?: string;
  readonly customDir?: string;
}

export interface TemplateSearchOptions {
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly query?: string;
}

export interface SaveTemplateInput {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly draft: ProposalDraft;
  readonly author?: string;
}

export interface TemplateStore {
  readonly list: (search?: TemplateSearchOptions) => Promise<readonly ProposalTemplate[]>;
  readonly get: (templateId: string) => Promise<ProposalTemplateWithDraft | null>;
  readonly save: (input: SaveTemplateInput) => Promise<ProposalTemplate>;
  readonly delete: (templateId: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Template store factory
// ---------------------------------------------------------------------------

export function createTemplateStore(
  options: TemplateStoreOptions = {},
): TemplateStore {
  const builtInDir = options.builtInDir ?? BUILT_IN_TEMPLATES_DIR;
  const customDir = resolve(options.customDir ?? DEFAULT_CUSTOM_TEMPLATES_DIR);
  const builtInCache = new Map<string, ProposalTemplateWithDraft>();

  return {
    list: (search) => listTemplates(builtInDir, customDir, builtInCache, search),
    get: (templateId) => getTemplate(builtInDir, customDir, builtInCache, templateId),
    save: (input) => saveTemplate(customDir, input),
    delete: (templateId) => deleteTemplate(customDir, templateId),
  };
}

// ---------------------------------------------------------------------------
// Built-in template discovery
// ---------------------------------------------------------------------------

async function loadBuiltInTemplates(
  builtInDir: string,
  cache: Map<string, ProposalTemplateWithDraft>,
): Promise<readonly ProposalTemplateWithDraft[]> {
  if (cache.size > 0) return [...cache.values()];

  let entries;
  try {
    entries = await readdir(builtInDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: ProposalTemplateWithDraft[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = join(builtInDir, entry.name);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isBuiltInTemplateFile(parsed)) continue;

      const validation = validateProposalDraft(parsed.draft);
      if (!validation.ok) continue;

      const template: ProposalTemplate = {
        templateId: parsed.templateId,
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        builtIn: true,
        author: parsed.author,
        tags: [...parsed.tags],
      };

      const templateWithDraft: ProposalTemplateWithDraft = {
        ...template,
        draft: validation.value,
      };

      cache.set(parsed.templateId, templateWithDraft);
      results.push(templateWithDraft);
    } catch {
      // Skip corrupt template files.
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

async function listTemplates(
  builtInDir: string,
  customDir: string,
  cache: Map<string, ProposalTemplateWithDraft>,
  search?: TemplateSearchOptions,
): Promise<readonly ProposalTemplate[]> {
  const builtIns = await loadBuiltInTemplates(builtInDir, cache);
  const customs = await loadCustomTemplateMetadata(customDir);
  const all: ProposalTemplate[] = [...builtIns, ...customs];

  if (search === undefined) return all;
  return filterTemplates(all, search);
}

async function getTemplate(
  builtInDir: string,
  customDir: string,
  cache: Map<string, ProposalTemplateWithDraft>,
  templateId: string,
): Promise<ProposalTemplateWithDraft | null> {
  // Check built-in cache first.
  const cached = cache.get(templateId);
  if (cached !== undefined) return cached;

  // Load built-ins (populates cache).
  await loadBuiltInTemplates(builtInDir, cache);
  const afterBuiltIn = cache.get(templateId);
  if (afterBuiltIn !== undefined) return afterBuiltIn;

  // Try custom templates.
  return loadCustomTemplate(customDir, templateId);
}

async function saveTemplate(
  customDir: string,
  input: SaveTemplateInput,
): Promise<ProposalTemplate> {
  const templateId = `custom/${randomUUID()}`;
  const now = new Date().toISOString();

  const template: ProposalTemplate = {
    templateId,
    name: input.name,
    description: input.description,
    category: input.category,
    builtIn: false,
    createdAt: now,
    author: input.author,
    tags: [...input.tags],
  };

  const fileData: BuiltInTemplateFile = {
    ...template,
    draft: input.draft,
  };

  await ensureDirectory(customDir);
  const filePath = join(customDir, `${encodeTemplateId(templateId)}.json`);
  await writeFile(filePath, JSON.stringify(fileData, null, 2), "utf8");

  return template;
}

async function deleteTemplate(
  customDir: string,
  templateId: string,
): Promise<boolean> {
  if (templateId.startsWith("built-in/")) return false;

  const filePath = join(customDir, `${encodeTemplateId(templateId)}.json`);
  try {
    await rm(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Custom template helpers
// ---------------------------------------------------------------------------

async function loadCustomTemplateMetadata(
  customDir: string,
): Promise<readonly ProposalTemplate[]> {
  let entries;
  try {
    entries = await readdir(customDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: ProposalTemplate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = join(customDir, entry.name);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isCustomTemplateFile(parsed)) continue;

      results.push({
        templateId: parsed.templateId,
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        builtIn: false,
        createdAt: parsed.createdAt,
        author: parsed.author,
        tags: [...parsed.tags],
      });
    } catch {
      // Skip corrupt files.
    }
  }

  return results;
}

async function loadCustomTemplate(
  customDir: string,
  templateId: string,
): Promise<ProposalTemplateWithDraft | null> {
  const filePath = join(customDir, `${encodeTemplateId(templateId)}.json`);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (!isCustomTemplateFile(parsed)) return null;

  const validation = validateProposalDraft(parsed.draft);
  if (!validation.ok) return null;

  return {
    templateId: parsed.templateId,
    name: parsed.name,
    description: parsed.description,
    category: parsed.category,
    builtIn: false,
    createdAt: parsed.createdAt,
    author: parsed.author,
    tags: [...parsed.tags],
    draft: validation.value,
  };
}

// ---------------------------------------------------------------------------
// Search / filter
// ---------------------------------------------------------------------------

function filterTemplates(
  templates: readonly ProposalTemplate[],
  search: TemplateSearchOptions,
): readonly ProposalTemplate[] {
  return templates.filter((template) => {
    if (search.category !== undefined && template.category !== search.category) return false;
    if (search.tags !== undefined && search.tags.length > 0) {
      const hasMatchingTag = search.tags.some((tag) => template.tags.includes(tag));
      if (!hasMatchingTag) return false;
    }
    if (search.query !== undefined && search.query.trim().length > 0) {
      const lower = search.query.toLowerCase();
      const nameMatch = template.name.toLowerCase().includes(lower);
      const descMatch = template.description.toLowerCase().includes(lower);
      if (!nameMatch && !descMatch) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// File format validation
// ---------------------------------------------------------------------------

interface BuiltInTemplateFile {
  readonly templateId: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly builtIn: boolean;
  readonly author?: string;
  readonly tags: readonly string[];
  readonly draft: unknown;
}

function isBuiltInTemplateFile(input: unknown): input is BuiltInTemplateFile {
  if (!isRecord(input)) return false;
  return (
    typeof input.templateId === "string" &&
    typeof input.name === "string" &&
    typeof input.description === "string" &&
    typeof input.category === "string" &&
    typeof input.builtIn === "boolean" &&
    Array.isArray(input.tags) &&
    input.draft !== undefined
  );
}

function isCustomTemplateFile(input: unknown): input is BuiltInTemplateFile {
  if (!isRecord(input)) return false;
  return (
    typeof input.templateId === "string" &&
    typeof input.name === "string" &&
    typeof input.description === "string" &&
    typeof input.category === "string" &&
    Array.isArray(input.tags) &&
    input.draft !== undefined
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function encodeTemplateId(templateId: string): string {
  return templateId.replace(/[^a-zA-Z0-9_-]/g, "_");
}
