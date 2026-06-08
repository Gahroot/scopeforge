import { createHash } from "node:crypto";
import { validateProposalBrand } from "../proposal/brands.js";
import { validateProposalDraft } from "../proposal/schema.js";
import type { ProposalBrand, ProposalDraft } from "../proposal/types.js";
import {
  PROPOSAL_PROJECT_SCHEMA_VERSION,
  type AddProposalArtifactInput,
  type CloseDisposableAgentThreadInput,
  type CommitProposalProjectVersionInput,
  type ContentHash,
  type CreateProposalBrandSnapshotInput,
  type CreateProposalProjectInput,
  type DisposableAgentThread,
  type DisposableAgentThreadId,
  type DisposeDisposableAgentThreadInput,
  type OpenDisposableAgentThreadInput,
  type ProposalArtifactId,
  type ProposalArtifactKind,
  type ProposalArtifactMetadata,
  type ProposalArtifactOrigin,
  type ProposalAuthorId,
  type ProposalAuthorKind,
  type ProposalAuthorMetadata,
  type ProposalBrandExtractionProvenance,
  type ProposalBrandRole,
  type ProposalBrandSnapshot,
  type ProposalBrandSnapshotId,
  type ProposalProject,
  type ProposalProjectId,
  type ProposalProjectSourceOfTruth,
  type ProposalProjectStatus,
  type ProposalProjectValidationError,
  type ProposalProjectValidationResult,
  type ProposalProjectVersion,
  type ProposalProjectVersionHashes,
  type ProposalProjectVersionId,
  type ProposalProjectVersionSource,
} from "./types.js";

const PROJECT_STATUSES = ["active", "archived"] as const satisfies readonly ProposalProjectStatus[];

const AUTHOR_KINDS = ["human", "agent", "system"] as const satisfies readonly ProposalAuthorKind[];

const BRAND_ROLES = ["vendor", "client"] as const satisfies readonly ProposalBrandRole[];

const BRAND_PROVENANCE_KINDS = ["website-brand-extraction"] as const;

const BRAND_COLOR_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text",
  "mutedText",
  "border",
] as const;

const VERSION_SOURCES = [
  "human-edit",
  "agent-edit",
  "import",
  "restore",
  "system",
] as const satisfies readonly ProposalProjectVersionSource[];

const AGENT_THREAD_STATUSES = ["open", "closed", "discarded"] as const;

const ARTIFACT_KINDS = [
  "proposal-pdf",
  "proposal-html",
  "proposal-preview",
  "draft-json-export",
  "brand-json-export",
  "analysis-json-export",
  "attachment",
] as const satisfies readonly ProposalArtifactKind[];

const ARTIFACT_ORIGINS = [
  "render",
  "export",
  "upload",
  "agent",
  "system",
] as const satisfies readonly ProposalArtifactOrigin[];

const ARTIFACT_RENDER_AUDIENCES = ["client", "internal"] as const;

const PDF_SOURCE_FIELD_NAMES = ["pdf", "pdfUrl", "pdfBytes", "renderedPdf", "sourcePdf"] as const;

interface CreateProposalAuthorMetadataInput {
  readonly authorId: string | ProposalAuthorId;
  readonly displayName: string;
  readonly kind: ProposalAuthorKind;
  readonly email?: string;
  readonly organization?: string;
}

export function toProposalProjectId(input: string): ProposalProjectId {
  return input as ProposalProjectId;
}

export function toProposalProjectVersionId(input: string): ProposalProjectVersionId {
  return input as ProposalProjectVersionId;
}

export function toProposalBrandSnapshotId(input: string): ProposalBrandSnapshotId {
  return input as ProposalBrandSnapshotId;
}

export function toProposalArtifactId(input: string): ProposalArtifactId {
  return input as ProposalArtifactId;
}

export function toDisposableAgentThreadId(input: string): DisposableAgentThreadId {
  return input as DisposableAgentThreadId;
}

export function toProposalAuthorId(input: string): ProposalAuthorId {
  return input as ProposalAuthorId;
}

export function toContentHash(input: string): ContentHash {
  return input as ContentHash;
}

export function createProposalAuthorMetadata(
  input: CreateProposalAuthorMetadataInput,
): ProposalAuthorMetadata {
  return {
    authorId: toProposalAuthorId(input.authorId),
    displayName: input.displayName,
    kind: input.kind,
    ...(input.email === undefined ? {} : { email: input.email }),
    ...(input.organization === undefined ? {} : { organization: input.organization }),
  } satisfies ProposalAuthorMetadata;
}

export function canonicalJson(input: unknown): string {
  return renderCanonicalJson(input);
}

export function hashJson(input: unknown): ContentHash {
  const digest = createHash("sha256").update(canonicalJson(input)).digest("hex");
  return toContentHash(`sha256:${digest}`);
}

export function hashProposalDraft(draft: ProposalDraft): ContentHash {
  return hashJson(draft);
}

export function hashProposalBrand(brand: ProposalBrand): ContentHash {
  return hashJson(brand);
}

export function hashProposalSourceOfTruth(
  sourceOfTruth: ProposalProjectSourceOfTruth,
): ProposalProjectVersionHashes {
  return {
    draftHash: hashProposalDraft(sourceOfTruth.draft),
    vendorBrandHash: hashProposalBrand(sourceOfTruth.vendorBrand),
    clientBrandHash: hashProposalBrand(sourceOfTruth.clientBrand),
    sourceHash: hashJson(sourceOfTruth),
  } satisfies ProposalProjectVersionHashes;
}

export function createProposalProject(input: CreateProposalProjectInput): ProposalProject {
  const createdAt = input.createdAt ?? nowIso();
  const hashes = hashProposalSourceOfTruth(input.sourceOfTruth);
  const versionId = input.versionId ?? defaultVersionId(1, hashes.sourceHash);
  const projectId = input.projectId ?? defaultProjectId(input.sourceOfTruth, hashes.sourceHash);
  const version = createProjectVersion({
    versionId,
    versionNumber: 1,
    sourceOfTruth: input.sourceOfTruth,
    hashes,
    createdAt,
    createdBy: input.createdBy,
    source: input.source ?? "human-edit",
    ...(input.label === undefined ? {} : { label: input.label }),
  });

  return {
    schemaVersion: PROPOSAL_PROJECT_SCHEMA_VERSION,
    projectId,
    title: input.title ?? input.sourceOfTruth.draft.details.title,
    status: input.status ?? "active",
    createdAt,
    updatedAt: createdAt,
    createdBy: input.createdBy,
    currentVersionId: version.versionId,
    versions: [version],
    brandSnapshots: createBrandSnapshotsForVersion(version, input.createdBy, createdAt),
    agentThreads: [],
    artifacts: [],
  } satisfies ProposalProject;
}

export function commitProposalProjectVersion(
  project: ProposalProject,
  input: CommitProposalProjectVersionInput,
): ProposalProject {
  const parentVersionId = input.parentVersionId ?? project.currentVersionId;
  if (getProjectVersion(project, parentVersionId) === null) {
    throw new Error(`Cannot commit proposal project version without parent ${parentVersionId}.`);
  }

  const createdAt = input.createdAt ?? nowIso();
  const hashes = hashProposalSourceOfTruth(input.sourceOfTruth);
  const versionNumber = nextVersionNumber(project);
  const versionId = input.versionId ?? defaultVersionId(versionNumber, hashes.sourceHash);
  if (getProjectVersion(project, versionId) !== null) {
    throw new Error(`Proposal project version already exists: ${versionId}.`);
  }

  const version = createProjectVersion({
    versionId,
    versionNumber,
    parentVersionId,
    sourceOfTruth: input.sourceOfTruth,
    hashes,
    createdAt,
    createdBy: input.createdBy,
    source: input.source ?? "human-edit",
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });

  return {
    ...project,
    updatedAt: createdAt,
    updatedBy: input.createdBy,
    currentVersionId: version.versionId,
    versions: [...project.versions, version],
    brandSnapshots: [
      ...project.brandSnapshots,
      ...createBrandSnapshotsForVersion(version, input.createdBy, createdAt, input.brandProvenance),
    ],
  } satisfies ProposalProject;
}

export function createProposalBrandSnapshot(
  input: CreateProposalBrandSnapshotInput,
): ProposalBrandSnapshot {
  const capturedAt = input.capturedAt ?? nowIso();
  const brandHash = hashProposalBrand(input.brand);
  return {
    snapshotId:
      input.snapshotId ?? defaultBrandSnapshotId(input.role, brandHash, input.sourceVersionId),
    role: input.role,
    brand: input.brand,
    brandHash,
    capturedAt,
    capturedBy: input.capturedBy,
    ...(input.sourceVersionId === undefined ? {} : { sourceVersionId: input.sourceVersionId }),
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
  } satisfies ProposalBrandSnapshot;
}

export function getCurrentProjectVersion(project: ProposalProject): ProposalProjectVersion | null {
  return getProjectVersion(project, project.currentVersionId);
}

export function getProjectVersion(
  project: ProposalProject,
  versionId: ProposalProjectVersionId,
): ProposalProjectVersion | null {
  for (const version of project.versions) {
    if (version.versionId === versionId) return version;
  }
  return null;
}

export function getCurrentProjectSourceOfTruth(
  project: ProposalProject,
): ProposalProjectSourceOfTruth | null {
  return getCurrentProjectVersion(project)?.sourceOfTruth ?? null;
}

export function openDisposableAgentThread(
  project: ProposalProject,
  input: OpenDisposableAgentThreadInput,
): ProposalProject {
  const createdAt = input.createdAt ?? nowIso();
  const baseVersionId = input.baseVersionId ?? project.currentVersionId;
  if (getProjectVersion(project, baseVersionId) === null) {
    throw new Error(`Cannot open agent thread against missing version ${baseVersionId}.`);
  }

  const threadId =
    input.threadId ?? defaultAgentThreadId(project.projectId, baseVersionId, createdAt);
  if (getAgentThread(project, threadId) !== null) {
    throw new Error(`Disposable agent thread already exists: ${threadId}.`);
  }

  const thread = {
    threadId,
    projectId: project.projectId,
    status: "open",
    baseVersionId,
    createdAt,
    updatedAt: createdAt,
    createdBy: input.createdBy,
    artifactIds: [],
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.objective === undefined ? {} : { objective: input.objective }),
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  } satisfies DisposableAgentThread;

  return {
    ...project,
    updatedAt: createdAt,
    updatedBy: input.createdBy,
    agentThreads: [...project.agentThreads, thread],
  } satisfies ProposalProject;
}

export function closeDisposableAgentThread(
  project: ProposalProject,
  threadId: DisposableAgentThreadId,
  input: CloseDisposableAgentThreadInput = {},
): ProposalProject {
  const closedAt = input.closedAt ?? nowIso();
  const thread = getAgentThread(project, threadId);
  if (thread === null) return project;
  if (
    input.committedVersionId !== undefined &&
    getProjectVersion(project, input.committedVersionId) === null
  ) {
    throw new Error(`Cannot close agent thread with missing commit ${input.committedVersionId}.`);
  }

  const artifactIds = input.artifactIds ?? thread.artifactIds;
  assertKnownArtifacts(project, artifactIds);

  return {
    ...project,
    updatedAt: closedAt,
    agentThreads: project.agentThreads.map((candidate) =>
      candidate.threadId === threadId
        ? {
            ...candidate,
            status: "closed",
            updatedAt: closedAt,
            artifactIds,
            ...(input.committedVersionId === undefined
              ? {}
              : { committedVersionId: input.committedVersionId }),
          }
        : candidate,
    ),
  } satisfies ProposalProject;
}

export function disposeDisposableAgentThread(
  project: ProposalProject,
  threadId: DisposableAgentThreadId,
  input: DisposeDisposableAgentThreadInput = {},
): ProposalProject {
  const disposedAt = input.disposedAt ?? nowIso();
  if (getAgentThread(project, threadId) === null) return project;

  return {
    ...project,
    updatedAt: disposedAt,
    agentThreads: project.agentThreads.map((candidate) =>
      candidate.threadId === threadId
        ? {
            ...candidate,
            status: "discarded",
            updatedAt: disposedAt,
            ...(input.disposalReason === undefined ? {} : { disposalReason: input.disposalReason }),
          }
        : candidate,
    ),
  } satisfies ProposalProject;
}

export function addProposalArtifact(
  project: ProposalProject,
  input: AddProposalArtifactInput,
): ProposalProject {
  const createdAt = input.createdAt ?? nowIso();
  const sourceVersionId = input.sourceVersionId ?? project.currentVersionId;
  const sourceVersion = getProjectVersion(project, sourceVersionId);
  if (sourceVersion === null) {
    throw new Error(`Cannot add proposal artifact for missing version ${sourceVersionId}.`);
  }
  if (input.threadId !== undefined && getAgentThread(project, input.threadId) === null) {
    throw new Error(`Cannot attach proposal artifact to missing thread ${input.threadId}.`);
  }

  const artifactId = input.artifactId ?? defaultArtifactId(input.kind, sourceVersionId, input.uri);
  if (getArtifact(project, artifactId) !== null) {
    throw new Error(`Proposal artifact already exists: ${artifactId}.`);
  }

  const artifact = {
    artifactId,
    kind: input.kind,
    origin: input.origin,
    uri: input.uri,
    createdAt,
    createdBy: input.createdBy,
    sourceVersionId,
    sourceVersionHash: sourceVersion.hashes.sourceHash,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
    ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
    ...(input.bytes === undefined ? {} : { bytes: input.bytes }),
    ...(input.artifactHash === undefined ? {} : { artifactHash: input.artifactHash }),
    ...(input.render === undefined ? {} : { render: input.render }),
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
  } satisfies ProposalArtifactMetadata;

  return {
    ...project,
    updatedAt: createdAt,
    updatedBy: input.createdBy,
    artifacts: [...project.artifacts, artifact],
    agentThreads:
      input.threadId === undefined
        ? project.agentThreads
        : project.agentThreads.map((thread) =>
            thread.threadId === input.threadId
              ? {
                  ...thread,
                  updatedAt: createdAt,
                  artifactIds: [...thread.artifactIds, artifactId],
                }
              : thread,
          ),
  } satisfies ProposalProject;
}

export function validateProposalProject(
  input: unknown,
): ProposalProjectValidationResult<ProposalProject> {
  const errors: ProposalProjectValidationError[] = [];

  if (!isRecord(input)) {
    return validationFailure([{ path: "$", message: "Proposal project must be an object." }]);
  }

  validateNoPdfSourceFields(input, "$", errors);
  validateSchemaVersion(input.schemaVersion, "schemaVersion", errors);
  validateRequiredString(input, "projectId", "projectId", errors);
  validateRequiredString(input, "title", "title", errors);
  validateEnum(input.status, "status", PROJECT_STATUSES, "Project status", errors);
  validateRequiredString(input, "createdAt", "createdAt", errors);
  validateRequiredString(input, "updatedAt", "updatedAt", errors);
  validateAuthor(input.createdBy, "createdBy", errors);
  validateOptionalAuthor(input.updatedBy, "updatedBy", errors);
  validateRequiredString(input, "currentVersionId", "currentVersionId", errors);

  const versionIndex = validateProjectVersions(input.versions, errors);
  validateBrandSnapshots(input.brandSnapshots, versionIndex.versionIds, errors);
  const artifactIndex = validateArtifacts(input.artifacts, versionIndex.hashesByVersionId, errors);
  validateAgentThreads(
    input.agentThreads,
    input.projectId,
    versionIndex.versionIds,
    artifactIndex,
    errors,
  );

  if (
    typeof input.currentVersionId === "string" &&
    !versionIndex.versionIds.has(input.currentVersionId)
  ) {
    addError(errors, "currentVersionId", "Current version must reference an existing version.");
  }

  if (errors.length > 0) return validationFailure(errors);
  return { ok: true, value: input as unknown as ProposalProject };
}

interface ProjectVersionIndex {
  readonly versionIds: ReadonlySet<string>;
  readonly hashesByVersionId: ReadonlyMap<string, ProposalProjectVersionHashes>;
}

interface CreateProjectVersionInternalInput {
  readonly versionId: ProposalProjectVersionId;
  readonly versionNumber: number;
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
  readonly hashes: ProposalProjectVersionHashes;
  readonly createdAt: string;
  readonly createdBy: ProposalAuthorMetadata;
  readonly source: ProposalProjectVersionSource;
  readonly parentVersionId?: ProposalProjectVersionId;
  readonly label?: string;
  readonly reason?: string;
}

function createProjectVersion(input: CreateProjectVersionInternalInput): ProposalProjectVersion {
  return {
    versionId: input.versionId,
    versionNumber: input.versionNumber,
    ...(input.parentVersionId === undefined ? {} : { parentVersionId: input.parentVersionId }),
    createdAt: input.createdAt,
    createdBy: input.createdBy,
    source: input.source,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    sourceOfTruth: input.sourceOfTruth,
    hashes: input.hashes,
  } satisfies ProposalProjectVersion;
}

function createBrandSnapshotsForVersion(
  version: ProposalProjectVersion,
  capturedBy: ProposalAuthorMetadata,
  capturedAt: string,
  provenance: Partial<Record<ProposalBrandRole, ProposalBrandExtractionProvenance>> = {},
): readonly ProposalBrandSnapshot[] {
  return [
    createProposalBrandSnapshot({
      role: "vendor",
      brand: version.sourceOfTruth.vendorBrand,
      capturedBy,
      capturedAt,
      sourceVersionId: version.versionId,
      label: `Vendor brand for version ${version.versionNumber}`,
      source: "proposal-project-version",
      ...(provenance.vendor === undefined ? {} : { provenance: provenance.vendor }),
    }),
    createProposalBrandSnapshot({
      role: "client",
      brand: version.sourceOfTruth.clientBrand,
      capturedBy,
      capturedAt,
      sourceVersionId: version.versionId,
      label: `Client brand for version ${version.versionNumber}`,
      source: "proposal-project-version",
      ...(provenance.client === undefined ? {} : { provenance: provenance.client }),
    }),
  ];
}

function validateProjectVersions(
  input: unknown,
  errors: ProposalProjectValidationError[],
): ProjectVersionIndex {
  const versionIds = new Set<string>();
  const hashesByVersionId = new Map<string, ProposalProjectVersionHashes>();
  const versionNumbers = new Set<number>();

  if (!Array.isArray(input)) {
    addError(errors, "versions", "Must be an array.");
    return { versionIds, hashesByVersionId };
  }

  if (input.length === 0) {
    addError(errors, "versions", "Must contain at least 1 item.");
  }

  input.forEach((item, index) => {
    const path = `versions[${index}]`;
    const versionId = validateProjectVersion(item, path, errors);
    if (versionId === null) return;

    if (versionIds.has(versionId.id)) {
      addError(errors, `${path}.versionId`, "Version id must be unique within the project.");
    }
    versionIds.add(versionId.id);

    if (versionNumbers.has(versionId.versionNumber)) {
      addError(
        errors,
        `${path}.versionNumber`,
        "Version number must be unique within the project.",
      );
    }
    versionNumbers.add(versionId.versionNumber);
    hashesByVersionId.set(versionId.id, versionId.hashes);
  });

  input.forEach((item, index) => {
    if (!isRecord(item)) return;
    const parentVersionId = item.parentVersionId;
    if (parentVersionId === undefined) return;
    if (typeof parentVersionId === "string" && !versionIds.has(parentVersionId)) {
      addError(errors, `versions[${index}].parentVersionId`, "Parent version must exist.");
    }
  });

  return { versionIds, hashesByVersionId };
}

interface ValidatedVersionReference {
  readonly id: string;
  readonly versionNumber: number;
  readonly hashes: ProposalProjectVersionHashes;
}

function validateProjectVersion(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): ValidatedVersionReference | null {
  if (!isRecord(input)) {
    addError(errors, path, "Project version must be an object.");
    return null;
  }

  validateNoPdfSourceFields(input, path, errors);
  validateRequiredString(input, "versionId", `${path}.versionId`, errors);
  validateOptionalString(input, "parentVersionId", `${path}.parentVersionId`, errors);
  validateNumber(input.versionNumber, `${path}.versionNumber`, errors, {
    integer: true,
    minInclusive: 1,
    label: "Version number",
  });
  validateRequiredString(input, "createdAt", `${path}.createdAt`, errors);
  validateAuthor(input.createdBy, `${path}.createdBy`, errors);
  validateEnum(input.source, `${path}.source`, VERSION_SOURCES, "Version source", errors);
  validateOptionalString(input, "label", `${path}.label`, errors);
  validateOptionalString(input, "reason", `${path}.reason`, errors);

  const sourceOfTruthValid = validateSourceOfTruth(
    input.sourceOfTruth,
    `${path}.sourceOfTruth`,
    errors,
  );
  validateVersionHashes(input.hashes, `${path}.hashes`, errors);

  const expectedHashes = sourceOfTruthValid
    ? hashProposalSourceOfTruth(input.sourceOfTruth as ProposalProjectSourceOfTruth)
    : null;
  if (expectedHashes !== null && isRecord(input.hashes)) {
    compareHash(
      input.hashes.draftHash,
      expectedHashes.draftHash,
      `${path}.hashes.draftHash`,
      errors,
    );
    compareHash(
      input.hashes.vendorBrandHash,
      expectedHashes.vendorBrandHash,
      `${path}.hashes.vendorBrandHash`,
      errors,
    );
    compareHash(
      input.hashes.clientBrandHash,
      expectedHashes.clientBrandHash,
      `${path}.hashes.clientBrandHash`,
      errors,
    );
    compareHash(
      input.hashes.sourceHash,
      expectedHashes.sourceHash,
      `${path}.hashes.sourceHash`,
      errors,
    );
  }

  if (
    typeof input.versionId === "string" &&
    typeof input.versionNumber === "number" &&
    Number.isInteger(input.versionNumber) &&
    expectedHashes !== null
  ) {
    return {
      id: input.versionId,
      versionNumber: input.versionNumber,
      hashes: expectedHashes,
    } satisfies ValidatedVersionReference;
  }

  return null;
}

function validateSourceOfTruth(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  if (!isRecord(input)) {
    addError(
      errors,
      path,
      "Source of truth must be structured ProposalDraft plus vendor/client ProposalBrand JSON.",
    );
    return false;
  }

  validateNoPdfSourceFieldsDeep(input, path, errors);
  const draftValid = validateNestedProposalDraft(input.draft, `${path}.draft`, errors);
  const vendorBrandValid = validateNestedProposalBrand(
    input.vendorBrand,
    `${path}.vendorBrand`,
    errors,
  );
  const clientBrandValid = validateNestedProposalBrand(
    input.clientBrand,
    `${path}.clientBrand`,
    errors,
  );

  return draftValid && vendorBrandValid && clientBrandValid;
}

function validateNestedProposalDraft(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  const result = validateProposalDraft(input);
  if (result.ok) return true;
  for (const error of result.errors) {
    addError(errors, nestedPath(path, error.path), error.message);
  }
  return false;
}

function validateNestedProposalBrand(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  const result = validateProposalBrand(input);
  if (result.ok) return true;
  for (const error of result.errors) {
    addError(errors, nestedPath(path, error.path), error.message);
  }
  return false;
}

function validateVersionHashes(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  if (!isRecord(input)) {
    addError(errors, path, "Version hashes must be an object.");
    return false;
  }

  validateHash(input.draftHash, `${path}.draftHash`, errors);
  validateHash(input.vendorBrandHash, `${path}.vendorBrandHash`, errors);
  validateHash(input.clientBrandHash, `${path}.clientBrandHash`, errors);
  validateHash(input.sourceHash, `${path}.sourceHash`, errors);
  return true;
}

function validateBrandSnapshots(
  input: unknown,
  versionIds: ReadonlySet<string>,
  errors: ProposalProjectValidationError[],
): void {
  const snapshotIds = new Set<string>();
  if (!Array.isArray(input)) {
    addError(errors, "brandSnapshots", "Must be an array.");
    return;
  }

  input.forEach((item, index) => {
    const path = `brandSnapshots[${index}]`;
    if (!isRecord(item)) {
      addError(errors, path, "Brand snapshot must be an object.");
      return;
    }

    validateRequiredString(item, "snapshotId", `${path}.snapshotId`, errors);
    validateEnum(item.role, `${path}.role`, BRAND_ROLES, "Brand role", errors);
    validateNestedProposalBrand(item.brand, `${path}.brand`, errors);
    validateHash(item.brandHash, `${path}.brandHash`, errors);
    validateRequiredString(item, "capturedAt", `${path}.capturedAt`, errors);
    validateAuthor(item.capturedBy, `${path}.capturedBy`, errors);
    validateOptionalString(item, "sourceVersionId", `${path}.sourceVersionId`, errors);
    validateOptionalString(item, "label", `${path}.label`, errors);
    validateOptionalString(item, "source", `${path}.source`, errors);
    validateOptionalBrandProvenance(item.provenance, `${path}.provenance`, item.role, errors);

    if (typeof item.snapshotId === "string") {
      if (snapshotIds.has(item.snapshotId)) {
        addError(errors, `${path}.snapshotId`, "Brand snapshot id must be unique.");
      }
      snapshotIds.add(item.snapshotId);
    }
    if (typeof item.sourceVersionId === "string" && !versionIds.has(item.sourceVersionId)) {
      addError(errors, `${path}.sourceVersionId`, "Brand snapshot version must exist.");
    }
    if (validateProposalBrand(item.brand).ok) {
      compareHash(
        item.brandHash,
        hashProposalBrand(item.brand as ProposalBrand),
        `${path}.brandHash`,
        errors,
      );
    }
  });
}

function validateOptionalBrandProvenance(
  input: unknown,
  path: string,
  snapshotRole: unknown,
  errors: ProposalProjectValidationError[],
): void {
  if (input === undefined) return;
  if (!isRecord(input)) {
    addError(errors, path, "Brand extraction provenance must be an object when provided.");
    return;
  }

  validateEnum(input.kind, `${path}.kind`, BRAND_PROVENANCE_KINDS, "Brand provenance kind", errors);
  validateEnum(input.role, `${path}.role`, BRAND_ROLES, "Brand provenance role", errors);
  validateRequiredString(input, "importedAt", `${path}.importedAt`, errors);
  if (
    typeof input.role === "string" &&
    typeof snapshotRole === "string" &&
    input.role !== snapshotRole
  ) {
    addError(errors, `${path}.role`, "Brand provenance role must match the snapshot role.");
  }

  validateWebsiteBrandSourceMetadata(input.source, `${path}.source`, errors);
  validateWebsiteBrandExtractionSources(input.sources, `${path}.sources`, errors);
  validateRecord(input.meta, `${path}.meta`, "Brand provenance meta", errors);
  validateBrandPalette(input.palette, `${path}.palette`, errors);
  if (input.manualOverrides !== undefined) {
    validateRecord(
      input.manualOverrides,
      `${path}.manualOverrides`,
      "Brand provenance manualOverrides",
      errors,
    );
  }
}

function validateWebsiteBrandSourceMetadata(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): void {
  if (!validateRecord(input, path, "Website brand source metadata", errors)) return;
  validateRequiredString(input, "requestedUrl", `${path}.requestedUrl`, errors);
  validateRequiredString(input, "normalizedUrl", `${path}.normalizedUrl`, errors);
  validateRequiredString(input, "finalUrl", `${path}.finalUrl`, errors);
  validateRequiredString(input, "fetchedAt", `${path}.fetchedAt`, errors);
  validateNumber(input.statusCode, `${path}.statusCode`, errors, {
    integer: true,
    minInclusive: 100,
    maxInclusive: 599,
    label: "Status code",
  });
  validateNumber(input.bytesRead, `${path}.bytesRead`, errors, {
    integer: true,
    minInclusive: 0,
    label: "Bytes read",
  });
  validateNumber(input.elapsedMs, `${path}.elapsedMs`, errors, {
    minInclusive: 0,
    label: "Elapsed milliseconds",
  });
  validateRequiredString(input, "extractor", `${path}.extractor`, errors);
  validateNumber(input.extractorVersion, `${path}.extractorVersion`, errors, {
    integer: true,
    minInclusive: 1,
    label: "Extractor version",
  });
  validateOptionalString(input, "contentType", `${path}.contentType`, errors);
  validateArray(input.redirects, `${path}.redirects`, "Redirects", errors);
  validateStringArray(input.warnings, `${path}.warnings`, errors);
}

function validateWebsiteBrandExtractionSources(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): void {
  if (!validateRecord(input, path, "Website brand extraction sources", errors)) return;
  validateRecord(input.name, `${path}.name`, "Name source", errors);
  validateOptionalRecord(input.tagline, `${path}.tagline`, "Tagline source", errors);
  validateOptionalRecord(input.logoUrl, `${path}.logoUrl`, "Logo URL source", errors);
  validateRecord(input.colors, `${path}.colors`, "Color sources", errors);
}

function validateBrandPalette(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): void {
  if (!validateRecord(input, path, "Brand provenance palette", errors)) return;
  for (const key of BRAND_COLOR_KEYS) {
    validateRequiredString(input, key, `${path}.${key}`, errors);
  }
}

function validateRecord(
  input: unknown,
  path: string,
  label: string,
  errors: ProposalProjectValidationError[],
): input is Readonly<Record<string, unknown>> {
  if (isRecord(input)) return true;
  addError(errors, path, `${label} must be an object.`);
  return false;
}

function validateOptionalRecord(
  input: unknown,
  path: string,
  label: string,
  errors: ProposalProjectValidationError[],
): void {
  if (input === undefined) return;
  validateRecord(input, path, label, errors);
}

function validateArray(
  input: unknown,
  path: string,
  label: string,
  errors: ProposalProjectValidationError[],
): void {
  if (Array.isArray(input)) return;
  addError(errors, path, `${label} must be an array.`);
}

function validateArtifacts(
  input: unknown,
  hashesByVersionId: ReadonlyMap<string, ProposalProjectVersionHashes>,
  errors: ProposalProjectValidationError[],
): ReadonlySet<string> {
  const artifactIds = new Set<string>();
  if (!Array.isArray(input)) {
    addError(errors, "artifacts", "Must be an array.");
    return artifactIds;
  }

  input.forEach((item, index) => {
    const path = `artifacts[${index}]`;
    if (!isRecord(item)) {
      addError(errors, path, "Artifact metadata must be an object.");
      return;
    }

    validateRequiredString(item, "artifactId", `${path}.artifactId`, errors);
    validateEnum(item.kind, `${path}.kind`, ARTIFACT_KINDS, "Artifact kind", errors);
    validateEnum(item.origin, `${path}.origin`, ARTIFACT_ORIGINS, "Artifact origin", errors);
    validateRequiredString(item, "uri", `${path}.uri`, errors);
    validateRequiredString(item, "createdAt", `${path}.createdAt`, errors);
    validateAuthor(item.createdBy, `${path}.createdBy`, errors);
    validateRequiredString(item, "sourceVersionId", `${path}.sourceVersionId`, errors);
    validateHash(item.sourceVersionHash, `${path}.sourceVersionHash`, errors);
    validateOptionalString(item, "label", `${path}.label`, errors);
    validateOptionalString(item, "fileName", `${path}.fileName`, errors);
    validateOptionalString(item, "mimeType", `${path}.mimeType`, errors);
    validateOptionalNumber(item.bytes, `${path}.bytes`, errors, {
      integer: true,
      minInclusive: 0,
      label: "Artifact bytes",
    });
    validateOptionalHash(item.artifactHash, `${path}.artifactHash`, errors);
    validateOptionalString(item, "threadId", `${path}.threadId`, errors);

    const expectedHashes =
      typeof item.sourceVersionId === "string"
        ? hashesByVersionId.get(item.sourceVersionId)
        : undefined;
    validateOptionalRenderMetadata(item.render, `${path}.render`, expectedHashes, errors);

    if (typeof item.artifactId === "string") {
      if (artifactIds.has(item.artifactId)) {
        addError(errors, `${path}.artifactId`, "Artifact id must be unique.");
      }
      artifactIds.add(item.artifactId);
    }

    if (typeof item.sourceVersionId === "string") {
      if (expectedHashes === undefined) {
        addError(errors, `${path}.sourceVersionId`, "Artifact source version must exist.");
      } else {
        compareHash(
          item.sourceVersionHash,
          expectedHashes.sourceHash,
          `${path}.sourceVersionHash`,
          errors,
        );
      }
    }
  });

  return artifactIds;
}

function validateOptionalRenderMetadata(
  input: unknown,
  path: string,
  expectedHashes: ProposalProjectVersionHashes | undefined,
  errors: ProposalProjectValidationError[],
): void {
  if (input === undefined) return;
  if (!isRecord(input)) {
    addError(errors, path, "Artifact render metadata must be an object when provided.");
    return;
  }

  validateRequiredString(input, "renderer", `${path}.renderer`, errors);
  validateNumber(input.rendererVersion, `${path}.rendererVersion`, errors, {
    integer: true,
    minInclusive: 1,
    label: "Renderer version",
  });
  validateEnum(input.audience, `${path}.audience`, ARTIFACT_RENDER_AUDIENCES, "Audience", errors);
  validateRequiredString(input, "templateId", `${path}.templateId`, errors);
  validateNumber(input.analysisSeed, `${path}.analysisSeed`, errors, {
    integer: true,
    minInclusive: 1,
    label: "Analysis seed",
  });
  validateNumber(input.analysisIterations, `${path}.analysisIterations`, errors, {
    integer: true,
    minInclusive: 1,
    label: "Analysis iterations",
  });
  validateHash(input.draftHash, `${path}.draftHash`, errors);
  validateHash(input.vendorBrandHash, `${path}.vendorBrandHash`, errors);
  validateHash(input.clientBrandHash, `${path}.clientBrandHash`, errors);
  validateHash(input.sourceHash, `${path}.sourceHash`, errors);
  validateOptionalString(input, "generatedAt", `${path}.generatedAt`, errors);
  validateOptionalString(input, "format", `${path}.format`, errors);

  if (expectedHashes === undefined) return;
  compareHash(input.draftHash, expectedHashes.draftHash, `${path}.draftHash`, errors);
  compareHash(
    input.vendorBrandHash,
    expectedHashes.vendorBrandHash,
    `${path}.vendorBrandHash`,
    errors,
  );
  compareHash(
    input.clientBrandHash,
    expectedHashes.clientBrandHash,
    `${path}.clientBrandHash`,
    errors,
  );
  compareHash(input.sourceHash, expectedHashes.sourceHash, `${path}.sourceHash`, errors);
}

function validateAgentThreads(
  input: unknown,
  projectId: unknown,
  versionIds: ReadonlySet<string>,
  artifactIds: ReadonlySet<string>,
  errors: ProposalProjectValidationError[],
): void {
  const threadIds = new Set<string>();
  if (!Array.isArray(input)) {
    addError(errors, "agentThreads", "Must be an array.");
    return;
  }

  input.forEach((item, index) => {
    const path = `agentThreads[${index}]`;
    if (!isRecord(item)) {
      addError(errors, path, "Disposable agent thread must be an object.");
      return;
    }

    validateRequiredString(item, "threadId", `${path}.threadId`, errors);
    validateRequiredString(item, "projectId", `${path}.projectId`, errors);
    validateEnum(
      item.status,
      `${path}.status`,
      AGENT_THREAD_STATUSES,
      "Agent thread status",
      errors,
    );
    validateRequiredString(item, "baseVersionId", `${path}.baseVersionId`, errors);
    validateRequiredString(item, "createdAt", `${path}.createdAt`, errors);
    validateRequiredString(item, "updatedAt", `${path}.updatedAt`, errors);
    validateAuthor(item.createdBy, `${path}.createdBy`, errors);
    validateOptionalString(item, "title", `${path}.title`, errors);
    validateOptionalString(item, "objective", `${path}.objective`, errors);
    validateOptionalString(item, "expiresAt", `${path}.expiresAt`, errors);
    validateOptionalString(item, "committedVersionId", `${path}.committedVersionId`, errors);
    validateOptionalString(item, "disposalReason", `${path}.disposalReason`, errors);
    validateStringArray(item.artifactIds, `${path}.artifactIds`, errors);

    if (typeof item.threadId === "string") {
      if (threadIds.has(item.threadId)) {
        addError(errors, `${path}.threadId`, "Agent thread id must be unique.");
      }
      threadIds.add(item.threadId);
    }
    if (
      typeof item.projectId === "string" &&
      typeof projectId === "string" &&
      item.projectId !== projectId
    ) {
      addError(errors, `${path}.projectId`, "Agent thread must belong to this project.");
    }
    if (typeof item.baseVersionId === "string" && !versionIds.has(item.baseVersionId)) {
      addError(errors, `${path}.baseVersionId`, "Agent thread base version must exist.");
    }
    if (typeof item.committedVersionId === "string" && !versionIds.has(item.committedVersionId)) {
      addError(errors, `${path}.committedVersionId`, "Agent thread committed version must exist.");
    }
    if (Array.isArray(item.artifactIds)) {
      item.artifactIds.forEach((artifactId, artifactIndex) => {
        if (typeof artifactId === "string" && !artifactIds.has(artifactId)) {
          addError(
            errors,
            `${path}.artifactIds[${artifactIndex}]`,
            "Agent thread artifact must exist.",
          );
        }
      });
    }
  });
}

function validateAuthor(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): input is ProposalAuthorMetadata {
  if (!isRecord(input)) {
    addError(errors, path, "Author metadata must be an object.");
    return false;
  }

  validateRequiredString(input, "authorId", `${path}.authorId`, errors);
  validateRequiredString(input, "displayName", `${path}.displayName`, errors);
  validateEnum(input.kind, `${path}.kind`, AUTHOR_KINDS, "Author kind", errors);
  validateOptionalString(input, "email", `${path}.email`, errors);
  validateOptionalString(input, "organization", `${path}.organization`, errors);
  return true;
}

function validateOptionalAuthor(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  if (input === undefined) return true;
  return validateAuthor(input, path, errors);
}

function validateSchemaVersion(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): void {
  if (input !== PROPOSAL_PROJECT_SCHEMA_VERSION) {
    addError(errors, path, `Schema version must be ${PROPOSAL_PROJECT_SCHEMA_VERSION}.`);
  }
}

function validateStringArray(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  if (!Array.isArray(input)) {
    addError(errors, path, "Must be an array.");
    return false;
  }

  input.forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      addError(errors, `${path}[${index}]`, "Must be a non-empty string.");
    }
  });
  return true;
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(errors, path, "Must be a non-empty string.");
    return false;
  }
  return true;
}

function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  const value = input[key];
  if (value === undefined) return true;
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(errors, path, "Must be a non-empty string when provided.");
    return false;
  }
  return true;
}

interface NumberBounds {
  readonly minInclusive?: number;
  readonly minExclusive?: number;
  readonly maxInclusive?: number;
  readonly integer?: boolean;
  readonly label?: string;
}

function validateNumber(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
  bounds: NumberBounds = {},
): boolean {
  const label = bounds.label ?? "Value";
  if (typeof input !== "number" || !Number.isFinite(input)) {
    addError(errors, path, `${label} must be a finite number.`);
    return false;
  }

  if (bounds.integer === true && !Number.isInteger(input)) {
    addError(errors, path, `${label} must be an integer.`);
  }
  if (bounds.minInclusive !== undefined && input < bounds.minInclusive) {
    addError(errors, path, `${label} must be at least ${bounds.minInclusive}.`);
  }
  if (bounds.minExclusive !== undefined && input <= bounds.minExclusive) {
    addError(errors, path, `${label} must be greater than ${bounds.minExclusive}.`);
  }
  if (bounds.maxInclusive !== undefined && input > bounds.maxInclusive) {
    addError(errors, path, `${label} must be at most ${bounds.maxInclusive}.`);
  }
  return true;
}

function validateOptionalNumber(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
  bounds: NumberBounds = {},
): boolean {
  if (input === undefined) return true;
  return validateNumber(input, path, errors, bounds);
}

function validateEnum<TValue extends string>(
  input: unknown,
  path: string,
  values: readonly TValue[],
  label: string,
  errors: ProposalProjectValidationError[],
): input is TValue {
  if (typeof input !== "string" || !values.some((value) => value === input)) {
    addError(errors, path, `${label} must be one of: ${values.join(", ")}.`);
    return false;
  }
  return true;
}

function validateHash(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): input is ContentHash {
  if (typeof input !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input)) {
    addError(errors, path, "Hash must be a sha256:<64 lowercase hex chars> string.");
    return false;
  }
  return true;
}

function validateOptionalHash(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): boolean {
  if (input === undefined) return true;
  return validateHash(input, path, errors);
}

function compareHash(
  actual: unknown,
  expected: string,
  path: string,
  errors: ProposalProjectValidationError[],
): void {
  if (typeof actual !== "string") return;
  if (actual !== expected) {
    addError(errors, path, "Hash does not match the structured JSON source.");
  }
}

function validateNoPdfSourceFields(
  input: Readonly<Record<string, unknown>>,
  path: string,
  errors: ProposalProjectValidationError[],
): void {
  for (const fieldName of PDF_SOURCE_FIELD_NAMES) {
    if (Object.hasOwn(input, fieldName)) {
      addPdfSourceError(errors, path === "$" ? fieldName : `${path}.${fieldName}`);
    }
  }
}

function validateNoPdfSourceFieldsDeep(
  input: unknown,
  path: string,
  errors: ProposalProjectValidationError[],
): void {
  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      validateNoPdfSourceFieldsDeep(item, `${path}[${index}]`, errors);
    });
    return;
  }

  if (!isRecord(input)) return;
  for (const key of Object.keys(input).sort()) {
    const childPath = path === "$" ? key : `${path}.${key}`;
    if (PDF_SOURCE_FIELD_NAMES.some((fieldName) => fieldName === key)) {
      addPdfSourceError(errors, childPath);
    }
    validateNoPdfSourceFieldsDeep(input[key], childPath, errors);
  }
}

function addPdfSourceError(errors: ProposalProjectValidationError[], path: string): void {
  addError(
    errors,
    path,
    "PDFs are rendered artifacts only; persist ProposalDraft plus vendor/client ProposalBrand JSON as the source of truth.",
  );
}

function validationFailure(
  errors: readonly ProposalProjectValidationError[],
): ProposalProjectValidationResult<never> {
  return { ok: false, errors };
}

function addError(errors: ProposalProjectValidationError[], path: string, message: string): void {
  errors.push({ path, message });
}

function nestedPath(parentPath: string, childPath: string): string {
  if (childPath === "$") return parentPath;
  return `${parentPath}.${childPath}`;
}

function assertKnownArtifacts(
  project: ProposalProject,
  artifactIds: readonly ProposalArtifactId[],
): void {
  const knownArtifactIds = new Set(project.artifacts.map((artifact) => artifact.artifactId));
  for (const artifactId of artifactIds) {
    if (!knownArtifactIds.has(artifactId)) {
      throw new Error(`Cannot reference missing proposal artifact ${artifactId}.`);
    }
  }
}

function getAgentThread(
  project: ProposalProject,
  threadId: DisposableAgentThreadId,
): DisposableAgentThread | null {
  for (const thread of project.agentThreads) {
    if (thread.threadId === threadId) return thread;
  }
  return null;
}

function getArtifact(
  project: ProposalProject,
  artifactId: ProposalArtifactId,
): ProposalArtifactMetadata | null {
  for (const artifact of project.artifacts) {
    if (artifact.artifactId === artifactId) return artifact;
  }
  return null;
}

function nextVersionNumber(project: ProposalProject): number {
  return (
    project.versions.reduce((highest, version) => Math.max(highest, version.versionNumber), 0) + 1
  );
}

function defaultProjectId(
  sourceOfTruth: ProposalProjectSourceOfTruth,
  sourceHash: ContentHash,
): ProposalProjectId {
  const base = slugify(
    [
      "project",
      sourceOfTruth.draft.metadata.draftId,
      sourceOfTruth.draft.preparedFor.companyName,
      sourceOfTruth.draft.details.title,
    ].join(" "),
  );
  return toProposalProjectId(`${base}-${shortHash(sourceHash)}`);
}

function defaultVersionId(
  versionNumber: number,
  sourceHash: ContentHash,
): ProposalProjectVersionId {
  return toProposalProjectVersionId(`version-${versionNumber}-${shortHash(sourceHash)}`);
}

function defaultBrandSnapshotId(
  role: ProposalBrandRole,
  brandHash: ContentHash,
  sourceVersionId: ProposalProjectVersionId | undefined,
): ProposalBrandSnapshotId {
  const versionPart = sourceVersionId === undefined ? "unversioned" : sourceVersionId;
  return toProposalBrandSnapshotId(`brand-${role}-${versionPart}-${shortHash(brandHash)}`);
}

function defaultAgentThreadId(
  projectId: ProposalProjectId,
  baseVersionId: ProposalProjectVersionId,
  createdAt: string,
): DisposableAgentThreadId {
  return toDisposableAgentThreadId(
    `thread-${shortHash(hashJson({ projectId, baseVersionId, createdAt }))}`,
  );
}

function defaultArtifactId(
  kind: ProposalArtifactKind,
  sourceVersionId: ProposalProjectVersionId,
  uri: string,
): ProposalArtifactId {
  return toProposalArtifactId(
    `artifact-${kind}-${shortHash(hashJson({ kind, sourceVersionId, uri }))}`,
  );
}

function shortHash(hash: ContentHash): string {
  return hash.replace(/^sha256:/, "").slice(0, 12);
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "proposal-project";
}

function nowIso(): string {
  return new Date().toISOString();
}

function renderCanonicalJson(input: unknown): string {
  if (input === null) return "null";

  if (Array.isArray(input)) {
    return `[${input.map((item) => (item === undefined ? "null" : renderCanonicalJson(item))).join(",")}]`;
  }

  if (input instanceof Date) {
    return JSON.stringify(input.toISOString());
  }

  switch (typeof input) {
    case "string":
      return JSON.stringify(input);
    case "number":
      if (!Number.isFinite(input)) throw new Error("Cannot hash non-finite numbers.");
      return JSON.stringify(input);
    case "boolean":
      return input ? "true" : "false";
    case "object":
      return renderCanonicalObject(input);
    case "undefined":
      return "null";
    default:
      throw new Error(`Cannot hash unsupported JSON value of type ${typeof input}.`);
  }
}

function renderCanonicalObject(input: object): string {
  const record = input as Readonly<Record<string, unknown>>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${renderCanonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
