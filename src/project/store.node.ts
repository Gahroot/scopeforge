import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  canonicalJson,
  commitProposalProjectVersion,
  createProposalProject,
  toProposalProjectId,
  toProposalProjectVersionId,
  validateProposalProject,
} from "./state.js";
import type {
  CommitProposalProjectVersionInput,
  CreateProposalProjectInput,
  ProposalProject,
  ProposalProjectId,
  ProposalProjectVersion,
  ProposalProjectVersionId,
} from "./types.js";

export const DEFAULT_LOCAL_PROJECT_DATA_DIR = ".scopeforge/proposal-projects";
export const PROJECT_RECORD_FILE_NAME = "project.json";
export const PROJECT_VERSIONS_DIRECTORY_NAME = "versions";

export type ProposalProjectStoreNow = () => Date | string;
export type ProposalProjectIdFactory = () => ProposalProjectId;
export type ProposalProjectVersionIdFactory = (
  input: ProposalProjectVersionIdFactoryInput,
) => ProposalProjectVersionId;

export interface ProposalProjectVersionIdFactoryInput {
  readonly projectId: ProposalProjectId;
  readonly versionNumber: number;
  readonly parentVersionId?: ProposalProjectVersionId;
  readonly createdAt: string;
}

export interface LocalProposalProjectStoreOptions {
  readonly dataDir?: string;
  readonly now?: ProposalProjectStoreNow;
  readonly projectIdFactory?: ProposalProjectIdFactory;
  readonly versionIdFactory?: ProposalProjectVersionIdFactory;
}

export interface ProposalProjectListItem {
  readonly projectId: ProposalProjectId;
  readonly title: string;
  readonly status: ProposalProject["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentVersionId: ProposalProjectVersionId;
  readonly versionCount: number;
}

export type ProposalProjectStoreLoadErrorCode =
  | "project_json_corrupt"
  | "project_json_invalid"
  | "project_version_json_corrupt"
  | "project_version_json_invalid"
  | "project_version_file_missing";

export interface ProposalProjectStoreLoadError {
  readonly code: ProposalProjectStoreLoadErrorCode;
  readonly path: string;
  readonly message: string;
  readonly details?: readonly string[];
}

export type ProposalProjectStoreLoadResult =
  | {
      readonly ok: true;
      readonly projects: readonly ProposalProjectListItem[];
    }
  | {
      readonly ok: false;
      readonly projects: readonly ProposalProjectListItem[];
      readonly errors: readonly ProposalProjectStoreLoadError[];
    };

export class LocalProposalProjectStore {
  readonly dataDir: string;
  private readonly now: ProposalProjectStoreNow;
  private readonly projectIdFactory: ProposalProjectIdFactory;
  private readonly versionIdFactory: ProposalProjectVersionIdFactory;
  private readonly projectsById = new Map<ProposalProjectId, ProposalProject>();

  constructor(options: LocalProposalProjectStoreOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? DEFAULT_LOCAL_PROJECT_DATA_DIR);
    this.now = options.now ?? defaultNow;
    this.projectIdFactory = options.projectIdFactory ?? defaultProjectIdFactory;
    this.versionIdFactory = options.versionIdFactory ?? defaultVersionIdFactory;
  }

  async load(): Promise<ProposalProjectStoreLoadResult> {
    this.projectsById.clear();
    await ensureDirectory(this.dataDir);

    const errors: ProposalProjectStoreLoadError[] = [];
    const entries = await readdir(this.dataDir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      const projectDir = join(this.dataDir, entry.name);
      const projectPath = join(projectDir, PROJECT_RECORD_FILE_NAME);
      const project = await readProjectRecord(projectPath, errors);
      if (project === null) continue;

      await verifyPersistedVersions(projectDir, project, errors);
      this.projectsById.set(project.projectId, cloneProject(project));
    }

    const projects = this.list();
    if (errors.length > 0) return { ok: false, projects, errors };
    return { ok: true, projects };
  }

  async save(project: ProposalProject): Promise<ProposalProject> {
    assertValidProject(project);
    await this.writeProject(project);
    const stored = cloneProject(project);
    this.projectsById.set(stored.projectId, stored);
    return cloneProject(stored);
  }

  list(): readonly ProposalProjectListItem[] {
    return [...this.projectsById.values()].map(projectListItem).sort(compareProjectListItems);
  }

  get(projectId: ProposalProjectId): ProposalProject | null {
    const project = this.projectsById.get(projectId);
    return project === undefined ? null : cloneProject(project);
  }

  async create(input: CreateProposalProjectInput): Promise<ProposalProject> {
    const projectId = input.projectId ?? this.projectIdFactory();
    const createdAt = input.createdAt ?? toIsoString(this.now());
    const versionId =
      input.versionId ??
      this.versionIdFactory({
        projectId,
        versionNumber: 1,
        createdAt,
      });
    const project = createProposalProject({
      ...input,
      projectId,
      versionId,
      createdAt,
    });
    return this.save(project);
  }

  async update(
    projectId: ProposalProjectId,
    input: CommitProposalProjectVersionInput,
  ): Promise<ProposalProject | null> {
    const project = this.projectsById.get(projectId);
    if (project === undefined) return null;

    const createdAt = input.createdAt ?? toIsoString(this.now());
    const parentVersionId = input.parentVersionId ?? project.currentVersionId;
    const versionNumber = nextVersionNumber(project);
    const versionId =
      input.versionId ??
      this.versionIdFactory({
        projectId,
        versionNumber,
        parentVersionId,
        createdAt,
      });
    const updated = commitProposalProjectVersion(project, {
      ...input,
      createdAt,
      parentVersionId,
      versionId,
    });
    return this.save(updated);
  }

  private async writeProject(project: ProposalProject): Promise<void> {
    const projectDir = projectDirectory(this.dataDir, project.projectId);
    const versionsDir = join(projectDir, PROJECT_VERSIONS_DIRECTORY_NAME);
    await ensureDirectory(versionsDir);

    for (const version of project.versions) {
      await writeImmutableVersionFile(join(versionsDir, versionFileName(version)), version);
    }

    await writeJsonFileAtomic(join(projectDir, PROJECT_RECORD_FILE_NAME), project);
  }
}

export function createLocalProposalProjectStore(
  options: LocalProposalProjectStoreOptions = {},
): LocalProposalProjectStore {
  return new LocalProposalProjectStore(options);
}

export function projectDirectory(dataDir: string, projectId: ProposalProjectId): string {
  return join(resolve(dataDir), encodePathSegment(projectId));
}

function defaultNow(): Date {
  return new Date();
}

function defaultProjectIdFactory(): ProposalProjectId {
  return toProposalProjectId(`project-${randomUUID()}`);
}

function defaultVersionIdFactory(
  input: ProposalProjectVersionIdFactoryInput,
): ProposalProjectVersionId {
  return toProposalProjectVersionId(`version-${input.versionNumber}-${randomUUID()}`);
}

function toIsoString(input: Date | string): string {
  return typeof input === "string" ? input : input.toISOString();
}

function projectListItem(project: ProposalProject): ProposalProjectListItem {
  return {
    projectId: project.projectId,
    title: project.title,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    currentVersionId: project.currentVersionId,
    versionCount: project.versions.length,
  } satisfies ProposalProjectListItem;
}

function compareProjectListItems(
  left: ProposalProjectListItem,
  right: ProposalProjectListItem,
): number {
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  if (updated !== 0) return updated;
  const title = left.title.localeCompare(right.title);
  if (title !== 0) return title;
  return left.projectId.localeCompare(right.projectId);
}

function nextVersionNumber(project: ProposalProject): number {
  return (
    project.versions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1
  );
}

function assertValidProject(project: ProposalProject): void {
  const result = validateProposalProject(project);
  if (result.ok) return;
  throw new Error(
    `Cannot persist invalid proposal project: ${result.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ")}`,
  );
}

async function readProjectRecord(
  projectPath: string,
  errors: ProposalProjectStoreLoadError[],
): Promise<ProposalProject | null> {
  const raw = await readJsonFile(projectPath, "project_json_corrupt", errors);
  if (raw === null) return null;

  const result = validateProposalProject(raw);
  if (!result.ok) {
    errors.push({
      code: "project_json_invalid",
      path: projectPath,
      message: "Persisted proposal project JSON did not match the project schema.",
      details: result.errors.map((error) => `${error.path}: ${error.message}`),
    });
    return null;
  }

  return result.value;
}

async function verifyPersistedVersions(
  projectDir: string,
  project: ProposalProject,
  errors: ProposalProjectStoreLoadError[],
): Promise<void> {
  const versionsDir = join(projectDir, PROJECT_VERSIONS_DIRECTORY_NAME);
  for (const version of project.versions) {
    const path = join(versionsDir, versionFileName(version));
    const raw = await readJsonFile(path, "project_version_json_corrupt", errors);
    if (raw === null) continue;
    const result = validatePersistedVersion(project, version, raw);
    if (!result.ok) {
      errors.push({
        code: result.code,
        path,
        message: result.message,
        details: result.details,
      });
    }
  }
}

type VersionValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "project_version_json_invalid";
      readonly message: string;
      readonly details: readonly string[];
    };

function validatePersistedVersion(
  project: ProposalProject,
  expected: ProposalProjectVersion,
  raw: unknown,
): VersionValidationResult {
  if (sameJson(raw, expected)) return { ok: true };

  const candidateProject = {
    ...project,
    currentVersionId: expected.versionId,
    versions: [raw],
    brandSnapshots: [],
    agentThreads: [],
    artifacts: [],
  };
  const candidateResult = validateProposalProject(candidateProject);
  const details = candidateResult.ok
    ? ["Version JSON is valid but does not match the version embedded in project.json."]
    : candidateResult.errors.map((error) => `${error.path}: ${error.message}`);

  return {
    ok: false,
    code: "project_version_json_invalid",
    message: "Persisted proposal project version JSON did not match the project record.",
    details,
  };
}

async function readJsonFile(
  path: string,
  corruptCode: "project_json_corrupt" | "project_version_json_corrupt",
  errors: ProposalProjectStoreLoadError[],
): Promise<unknown | null> {
  let raw = "";
  try {
    const handle = await open(path, "r");
    try {
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    errors.push({
      code:
        corruptCode === "project_json_corrupt"
          ? "project_json_corrupt"
          : "project_version_file_missing",
      path,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    errors.push({
      code: corruptCode,
      path,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeImmutableVersionFile(
  path: string,
  version: ProposalProjectVersion,
): Promise<void> {
  const existing = await readExistingJsonFile(path);
  if (existing.exists) {
    if (sameJson(existing.value, version)) return;
    throw new Error(`Cannot overwrite immutable proposal project version file: ${path}`);
  }
  await writeJsonFileAtomic(path, version);
}

type ExistingJsonFile =
  | { readonly exists: true; readonly value: unknown }
  | { readonly exists: false };

async function readExistingJsonFile(path: string): Promise<ExistingJsonFile> {
  let raw = "";
  try {
    const handle = await open(path, "r");
    try {
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isMissingFileError(error)) return { exists: false };
    throw error;
  }

  try {
    return { exists: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot parse existing immutable proposal project version file ${path}: ${message}`,
    );
  }
}

async function writeJsonFileAtomic(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await ensureDirectory(directory);
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
    await syncDirectory(directory);
  } finally {
    if (!renameComplete) {
      await handle.close().catch(() => undefined);
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is not available on every platform/filesystem; the file rename is still atomic.
  }
}

function versionFileName(version: ProposalProjectVersion): string {
  const paddedVersionNumber = String(version.versionNumber).padStart(6, "0");
  return `${paddedVersionNumber}-${encodePathSegment(version.versionId)}.json`;
}

function encodePathSegment(input: string): string {
  return encodeURIComponent(input).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT";
}

function cloneProject(project: ProposalProject): ProposalProject {
  return structuredClone(project) as ProposalProject;
}
