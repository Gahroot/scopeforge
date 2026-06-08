import type {
  ProposalAudience,
  ProposalBrand,
  ProposalBrandColors,
  ProposalDraft,
  ProposalDraftTemplateId,
  ProposalValidationError,
  ValidationResult,
} from "../proposal/types.js";
import type {
  WebsiteBrandExtractionSources,
  WebsiteBrandManualOverrides,
  WebsiteBrandMeta,
  WebsiteBrandSourceMetadata,
} from "../brand/types.js";

export const PROPOSAL_PROJECT_SCHEMA_VERSION = 1;

export type ProposalProjectSchemaVersion = typeof PROPOSAL_PROJECT_SCHEMA_VERSION;

export type ProposalProjectId = string & { readonly __brand: "ProposalProjectId" };
export type ProposalProjectVersionId = string & { readonly __brand: "ProposalProjectVersionId" };
export type ProposalBrandSnapshotId = string & { readonly __brand: "ProposalBrandSnapshotId" };
export type ProposalArtifactId = string & { readonly __brand: "ProposalArtifactId" };
export type DisposableAgentThreadId = string & { readonly __brand: "DisposableAgentThreadId" };
export type ProposalAuthorId = string & { readonly __brand: "ProposalAuthorId" };
export type ContentHash = string & { readonly __brand: "ContentHash" };

export type ProposalAuthorKind = "human" | "agent" | "system";

export interface ProposalAuthorMetadata {
  readonly authorId: ProposalAuthorId;
  readonly displayName: string;
  readonly kind: ProposalAuthorKind;
  readonly email?: string;
  readonly organization?: string;
}

export type ProposalProjectStatus = "active" | "archived";

export type ProposalBrandRole = "vendor" | "client";

export type ProposalProjectVersionSource =
  | "human-edit"
  | "agent-edit"
  | "import"
  | "restore"
  | "system";

export interface ProposalProjectSourceOfTruth {
  readonly draft: ProposalDraft;
  readonly vendorBrand: ProposalBrand;
  readonly clientBrand: ProposalBrand;
}

export interface ProposalProjectVersionHashes {
  readonly draftHash: ContentHash;
  readonly vendorBrandHash: ContentHash;
  readonly clientBrandHash: ContentHash;
  /** Hash of only the structured source-of-truth JSON: draft + vendor/client brands. */
  readonly sourceHash: ContentHash;
}

export interface ProposalProjectVersion {
  readonly versionId: ProposalProjectVersionId;
  readonly versionNumber: number;
  readonly parentVersionId?: ProposalProjectVersionId;
  readonly createdAt: string;
  readonly createdBy: ProposalAuthorMetadata;
  readonly source: ProposalProjectVersionSource;
  readonly label?: string;
  readonly reason?: string;
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
  readonly hashes: ProposalProjectVersionHashes;
}

export interface ProposalWebsiteBrandExtractionProvenance {
  readonly kind: "website-brand-extraction";
  readonly role: ProposalBrandRole;
  readonly importedAt: string;
  readonly source: WebsiteBrandSourceMetadata;
  readonly sources: WebsiteBrandExtractionSources;
  readonly meta: WebsiteBrandMeta;
  readonly palette: ProposalBrandColors;
  readonly manualOverrides?: WebsiteBrandManualOverrides;
}

export type ProposalBrandExtractionProvenance = ProposalWebsiteBrandExtractionProvenance;

export interface ProposalBrandSnapshot {
  readonly snapshotId: ProposalBrandSnapshotId;
  readonly role: ProposalBrandRole;
  readonly brand: ProposalBrand;
  readonly brandHash: ContentHash;
  readonly capturedAt: string;
  readonly capturedBy: ProposalAuthorMetadata;
  readonly sourceVersionId?: ProposalProjectVersionId;
  readonly label?: string;
  readonly source?: string;
  readonly provenance?: ProposalBrandExtractionProvenance;
}

export type DisposableAgentThreadStatus = "open" | "closed" | "discarded";

export interface DisposableAgentThread {
  readonly threadId: DisposableAgentThreadId;
  readonly projectId: ProposalProjectId;
  readonly status: DisposableAgentThreadStatus;
  readonly baseVersionId: ProposalProjectVersionId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: ProposalAuthorMetadata;
  readonly title?: string;
  readonly objective?: string;
  readonly expiresAt?: string;
  readonly committedVersionId?: ProposalProjectVersionId;
  readonly artifactIds: readonly ProposalArtifactId[];
  readonly disposalReason?: string;
}

export type ProposalArtifactKind =
  | "proposal-pdf"
  | "proposal-html"
  | "proposal-preview"
  | "draft-json-export"
  | "brand-json-export"
  | "analysis-json-export"
  | "attachment";

export type ProposalArtifactOrigin = "render" | "export" | "upload" | "agent" | "system";

export interface ProposalArtifactRenderMetadata {
  readonly renderer: string;
  readonly rendererVersion: number;
  readonly audience: ProposalAudience;
  readonly templateId: ProposalDraftTemplateId;
  readonly analysisSeed: number;
  readonly analysisIterations: number;
  readonly draftHash: ContentHash;
  readonly vendorBrandHash: ContentHash;
  readonly clientBrandHash: ContentHash;
  readonly sourceHash: ContentHash;
  readonly generatedAt?: string;
  readonly format?: string;
}

export interface ProposalArtifactMetadata {
  readonly artifactId: ProposalArtifactId;
  readonly kind: ProposalArtifactKind;
  readonly origin: ProposalArtifactOrigin;
  readonly uri: string;
  readonly createdAt: string;
  readonly createdBy: ProposalAuthorMetadata;
  /** Version whose structured JSON source produced this artifact. */
  readonly sourceVersionId: ProposalProjectVersionId;
  /** Hash of the producing version's ProposalDraft + vendor/client ProposalBrand JSON. */
  readonly sourceVersionHash: ContentHash;
  readonly label?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly bytes?: number;
  readonly artifactHash?: ContentHash;
  readonly render?: ProposalArtifactRenderMetadata;
  readonly threadId?: DisposableAgentThreadId;
}

export interface ProposalProject {
  readonly schemaVersion: ProposalProjectSchemaVersion;
  readonly projectId: ProposalProjectId;
  readonly title: string;
  readonly status: ProposalProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: ProposalAuthorMetadata;
  readonly currentVersionId: ProposalProjectVersionId;
  readonly versions: readonly ProposalProjectVersion[];
  readonly brandSnapshots: readonly ProposalBrandSnapshot[];
  readonly agentThreads: readonly DisposableAgentThread[];
  readonly artifacts: readonly ProposalArtifactMetadata[];
  readonly updatedBy?: ProposalAuthorMetadata;
}

export interface CreateProposalProjectInput {
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
  readonly createdBy: ProposalAuthorMetadata;
  readonly projectId?: ProposalProjectId;
  readonly versionId?: ProposalProjectVersionId;
  readonly title?: string;
  readonly createdAt?: string;
  readonly status?: ProposalProjectStatus;
  readonly label?: string;
  readonly source?: ProposalProjectVersionSource;
}

export interface CommitProposalProjectVersionInput {
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
  readonly createdBy: ProposalAuthorMetadata;
  readonly versionId?: ProposalProjectVersionId;
  readonly createdAt?: string;
  readonly label?: string;
  readonly reason?: string;
  readonly source?: ProposalProjectVersionSource;
  readonly parentVersionId?: ProposalProjectVersionId;
  readonly brandProvenance?: Partial<Record<ProposalBrandRole, ProposalBrandExtractionProvenance>>;
}

export interface CreateProposalBrandSnapshotInput {
  readonly role: ProposalBrandRole;
  readonly brand: ProposalBrand;
  readonly capturedBy: ProposalAuthorMetadata;
  readonly snapshotId?: ProposalBrandSnapshotId;
  readonly capturedAt?: string;
  readonly sourceVersionId?: ProposalProjectVersionId;
  readonly label?: string;
  readonly source?: string;
  readonly provenance?: ProposalBrandExtractionProvenance;
}

export interface OpenDisposableAgentThreadInput {
  readonly createdBy: ProposalAuthorMetadata;
  readonly threadId?: DisposableAgentThreadId;
  readonly baseVersionId?: ProposalProjectVersionId;
  readonly createdAt?: string;
  readonly title?: string;
  readonly objective?: string;
  readonly expiresAt?: string;
}

export interface CloseDisposableAgentThreadInput {
  readonly closedAt?: string;
  readonly committedVersionId?: ProposalProjectVersionId;
  readonly artifactIds?: readonly ProposalArtifactId[];
}

export interface DisposeDisposableAgentThreadInput {
  readonly disposedAt?: string;
  readonly disposalReason?: string;
}

export interface AddProposalArtifactInput {
  readonly kind: ProposalArtifactKind;
  readonly origin: ProposalArtifactOrigin;
  readonly uri: string;
  readonly createdBy: ProposalAuthorMetadata;
  readonly artifactId?: ProposalArtifactId;
  readonly sourceVersionId?: ProposalProjectVersionId;
  readonly createdAt?: string;
  readonly label?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly bytes?: number;
  readonly artifactHash?: ContentHash;
  readonly render?: ProposalArtifactRenderMetadata;
  readonly threadId?: DisposableAgentThreadId;
}

export type ProposalProjectValidationError = ProposalValidationError;
export type ProposalProjectValidationResult<T> = ValidationResult<T>;
