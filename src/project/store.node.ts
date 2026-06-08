import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  addProposalArtifact,
  canonicalJson,
  commitProposalProjectVersion,
  createProposalProject,
  toContentHash,
  toProposalProjectId,
  toProposalProjectVersionId,
  validateProposalProject,
} from "./state.js";
import type {
  AddProposalArtifactInput,
  CommitProposalProjectVersionInput,
  CreateProposalProjectInput,
  ProposalAuthorMetadata,
  ProposalArtifactMetadata,
  ProposalProject,
  ProposalProjectId,
  ProposalProjectStatus,
  ProposalProjectVersion,
  ProposalProjectVersionId,
} from "./types.js";

export const DEFAULT_LOCAL_PROJECT_DATA_DIR = ".scopeforge/proposal-projects";
export const PROJECT_RECORD_FILE_NAME = "project.json";
export const PROJECT_VERSIONS_DIRECTORY_NAME = "versions";
export const PROJECT_ARTIFACTS_DIRECTORY_NAME = "artifacts";
const PROJECT_LOCK_FILE_NAME = ".project.lock";
const PROJECT_LOCK_RETRY_MS = 25;
const PROJECT_LOCK_TIMEOUT_MS = 5_000;

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
  readonly createdBy: ProposalProject["createdBy"];
  readonly updatedBy?: ProposalProject["updatedBy"];
  readonly currentVersionId: ProposalProjectVersionId;
  readonly versionCount: number;
}

export interface ProposalProjectConflictMetadata {
  readonly projectId: ProposalProjectId;
  readonly title: string;
  readonly status: ProposalProjectStatus;
  readonly updatedAt: string;
  readonly updatedBy?: ProposalAuthorMetadata;
  readonly currentVersionId: ProposalProjectVersionId;
  readonly currentVersionNumber: number;
  readonly versionCount: number;
}

export class ProposalProjectBaseVersionRequiredError extends Error {
  override readonly name = "ProposalProjectBaseVersionRequiredError";
  readonly code = "base_version_required";
  readonly projectId: ProposalProjectId;

  constructor(projectId: ProposalProjectId) {
    super(`baseVersionId must identify the latest version for project ${projectId}.`);
    this.projectId = projectId;
  }
}

export class ProposalProjectVersionConflictError extends Error {
  override readonly name = "ProposalProjectVersionConflictError";
  readonly code = "base_version_conflict";
  readonly projectId: ProposalProjectId;
  readonly providedBaseVersionId: ProposalProjectVersionId;
  readonly latestProject: ProposalProjectConflictMetadata;

  constructor(input: {
    readonly project: ProposalProject;
    readonly providedBaseVersionId: ProposalProjectVersionId;
    readonly message?: string;
  }) {
    const latestProject = projectConflictMetadata(input.project);
    super(
      input.message ??
        `Project has changed since base version ${input.providedBaseVersionId}. Current version is ${latestProject.currentVersionId}.`,
    );
    this.projectId = input.project.projectId;
    this.providedBaseVersionId = input.providedBaseVersionId;
    this.latestProject = latestProject;
  }
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

export interface SaveProposalProjectArtifactInput
  extends Omit<AddProposalArtifactInput, "artifactHash" | "bytes" | "uri"> {
  readonly content: string | Uint8Array;
  readonly expectedCurrentVersionId?: ProposalProjectVersionId;
}

export interface SaveProposalProjectArtifactResult {
  readonly project: ProposalProject;
  readonly artifact: ProposalArtifactMetadata;
  readonly path: string;
  readonly relativePath: string;
  readonly bytes: number;
}

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
    const cachedProject = this.projectsById.get(projectId);
    if (cachedProject === undefined) return null;
    if (input.parentVersionId === undefined) {
      throw new ProposalProjectBaseVersionRequiredError(projectId);
    }

    return this.withProjectLock(projectId, async () => {
      const parentVersionId = input.parentVersionId;
      if (parentVersionId === undefined) {
        throw new ProposalProjectBaseVersionRequiredError(projectId);
      }

      const persistedProject = await this.readPersistedProject(projectId);
      const project = persistedProject ?? cachedProject;
      if (persistedProject !== null) {
        this.projectsById.set(projectId, cloneProject(persistedProject));
      }
      if (project.currentVersionId !== parentVersionId) {
        throw new ProposalProjectVersionConflictError({
          project,
          providedBaseVersionId: parentVersionId,
        });
      }

      const createdAt = input.createdAt ?? toIsoString(this.now());
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
    });
  }

  async saveArtifact(
    projectId: ProposalProjectId,
    input: SaveProposalProjectArtifactInput,
  ): Promise<SaveProposalProjectArtifactResult | null> {
    const cachedProject = this.projectsById.get(projectId);
    if (cachedProject === undefined) return null;

    return this.withProjectLock(projectId, async () => {
      const persistedProject = await this.readPersistedProject(projectId);
      const project = persistedProject ?? cachedProject;
      if (persistedProject !== null) {
        this.projectsById.set(projectId, cloneProject(persistedProject));
      }
      if (
        input.expectedCurrentVersionId !== undefined &&
        project.currentVersionId !== input.expectedCurrentVersionId
      ) {
        throw new ProposalProjectVersionConflictError({
          project,
          providedBaseVersionId: input.expectedCurrentVersionId,
        });
      }

      const sourceVersionId = input.sourceVersionId ?? project.currentVersionId;
      const sourceVersion = project.versions.find((version) => version.versionId === sourceVersionId);
      if (sourceVersion === undefined) {
        throw new Error(`Cannot save proposal artifact for missing version ${sourceVersionId}.`);
      }

      const content = artifactBytes(input.content);
      const artifactHash = hashBytes(content);
      const fileName = sanitizeArtifactFileName(input.fileName ?? defaultArtifactFileName(input.kind));
      const relativePath = artifactRelativePath(project, sourceVersion, fileName);
      const absolutePath = join(projectDirectory(this.dataDir, projectId), relativePath);
      await writeImmutableBinaryFile(absolutePath, content);

      const createdAt = input.createdAt ?? toIsoString(this.now());
      const updated = addProposalArtifact(project, {
        ...input,
        sourceVersionId,
        createdAt,
        uri: relativePath,
        fileName,
        bytes: content.byteLength,
        artifactHash,
      });
      const saved = await this.save(updated);
      const artifact = saved.artifacts[saved.artifacts.length - 1];
      if (artifact === undefined) {
        throw new Error("Saved proposal project did not include the new artifact metadata.");
      }

      return {
        project: saved,
        artifact,
        path: absolutePath,
        relativePath,
        bytes: content.byteLength,
      } satisfies SaveProposalProjectArtifactResult;
    });
  }

  private async withProjectLock<TValue>(
    projectId: ProposalProjectId,
    run: () => Promise<TValue>,
  ): Promise<TValue> {
    const projectDir = projectDirectory(this.dataDir, projectId);
    await ensureDirectory(projectDir);
    const release = await acquireProjectLock(join(projectDir, PROJECT_LOCK_FILE_NAME));
    try {
      return await run();
    } finally {
      await release();
    }
  }

  private async readPersistedProject(
    projectId: ProposalProjectId,
  ): Promise<ProposalProject | null> {
    const projectPath = join(projectDirectory(this.dataDir, projectId), PROJECT_RECORD_FILE_NAME);
    const existing = await readExistingJsonFile(projectPath);
    if (!existing.exists) return null;

    const result = validateProposalProject(existing.value);
    if (result.ok) return result.value;
    throw new Error(
      `Cannot update proposal project because persisted project JSON is invalid: ${result.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("; ")}`,
    );
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

export function projectConflictMetadata(project: ProposalProject): ProposalProjectConflictMetadata {
  const currentVersion = project.versions.find(
    (version) => version.versionId === project.currentVersionId,
  );
  return {
    projectId: project.projectId,
    title: project.title,
    status: project.status,
    updatedAt: project.updatedAt,
    ...(project.updatedBy === undefined ? {} : { updatedBy: project.updatedBy }),
    currentVersionId: project.currentVersionId,
    currentVersionNumber: currentVersion?.versionNumber ?? 0,
    versionCount: project.versions.length,
  } satisfies ProposalProjectConflictMetadata;
}

export function isProposalProjectVersionConflictError(
  error: unknown,
): error is ProposalProjectVersionConflictError {
  return error instanceof ProposalProjectVersionConflictError;
}

export function projectDirectory(dataDir: string, projectId: ProposalProjectId): string {
  return join(resolve(dataDir), encodePathSegment(projectId));
}

function artifactBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

function hashBytes(content: Uint8Array) {
  const digest = createHash("sha256").update(content).digest("hex");
  return toContentHash(`sha256:${digest}`);
}

function artifactRelativePath(
  project: ProposalProject,
  sourceVersion: ProposalProjectVersion,
  fileName: string,
): string {
  const artifactNumber = String(project.artifacts.length + 1).padStart(6, "0");
  return [
    PROJECT_ARTIFACTS_DIRECTORY_NAME,
    versionArtifactDirectoryName(sourceVersion),
    `${artifactNumber}-${fileName}`,
  ].join("/");
}

function versionArtifactDirectoryName(version: ProposalProjectVersion): string {
  const paddedVersionNumber = String(version.versionNumber).padStart(6, "0");
  return `${paddedVersionNumber}-${encodePathSegment(version.versionId)}`;
}

function defaultArtifactFileName(kind: AddProposalArtifactInput["kind"]): string {
  switch (kind) {
    case "proposal-pdf":
      return "proposal.pdf";
    case "proposal-html":
    case "proposal-preview":
      return "proposal.html";
    case "draft-json-export":
      return "draft.json";
    case "brand-json-export":
      return "brand.json";
    case "analysis-json-export":
      return "analysis.json";
    case "attachment":
      return "attachment.bin";
  }
}

function sanitizeArtifactFileName(input: string): string {
  const withoutPath = input.split(/[\\/]+/).at(-1) ?? "artifact.bin";
  const normalized = withoutPath
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized.length === 0 ? "artifact.bin" : normalized).replace(/["\\]/g, "-");
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
    createdBy: project.createdBy,
    ...(project.updatedBy === undefined ? {} : { updatedBy: project.updatedBy }),
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

async function writeImmutableBinaryFile(path: string, value: Uint8Array): Promise<void> {
  const directory = dirname(path);
  await ensureDirectory(directory);
  const handle = await open(path, "wx");
  let complete = false;
  try {
    await handle.writeFile(value);
    await handle.sync();
    complete = true;
  } finally {
    await handle.close().catch(() => undefined);
    if (!complete) await rm(path, { force: true }).catch(() => undefined);
  }
  await syncDirectory(directory);
}

type ProjectLockRelease = () => Promise<void>;

async function acquireProjectLock(path: string): Promise<ProjectLockRelease> {
  const startedAt = Date.now();
  for (;;) {
    try {
      const handle = await open(path, "wx");
      let initialized = false;
      try {
        await handle.writeFile(
          `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
          "utf8",
        );
        await handle.sync();
        initialized = true;
      } finally {
        await handle.close().catch(() => undefined);
        if (!initialized) await rm(path, { force: true }).catch(() => undefined);
      }
      await syncDirectory(dirname(path));
      return async () => {
        await rm(path, { force: true });
        await syncDirectory(dirname(path));
      };
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      if (Date.now() - startedAt >= PROJECT_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for proposal project update lock: ${path}`);
      }
      await sleep(PROJECT_LOCK_RETRY_MS);
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

function isFileExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "EEXIST";
}

function cloneProject(project: ProposalProject): ProposalProject {
  return structuredClone(project) as ProposalProject;
}
