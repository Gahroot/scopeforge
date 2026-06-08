import type { ProposalProjectConflictMetadata } from "../../project/store.node.js";
import type {
  ProposalArtifactMetadata,
  ProposalProject,
  ProposalProjectVersion,
} from "../../project/types.js";
import type {
  ApiError,
  ProposalProjectArtifactSummaryResponse,
  ProposalProjectStateResponse,
  ProposalProjectUpdatesResponse,
} from "./api.js";

export type ProjectConflictAction = "agent" | "brand import" | "export" | "preview" | "save";

export interface ProjectConflictNotice {
  readonly action: ProjectConflictAction;
  readonly message: string;
  readonly latestProject: ProposalProjectConflictMetadata;
  readonly occurredAt: string;
}

export function apiErrorToProjectConflict(
  error: ApiError,
  action: ProjectConflictAction,
  occurredAt: string,
): ProjectConflictNotice | null {
  if (error.latestProject === undefined) return null;
  return {
    action,
    message: error.message,
    latestProject: error.latestProject,
    occurredAt,
  } satisfies ProjectConflictNotice;
}

export function projectUpdateFromState(
  state: ProposalProjectStateResponse,
): ProposalProjectUpdatesResponse {
  return {
    ok: true,
    projectId: state.project.projectId,
    latestProject: projectConflictMetadataFromState(state),
    latestVersion: summarizeProjectVersion(state.currentVersion),
    artifactSummary: summarizeProjectArtifacts(state.project),
  } satisfies ProposalProjectUpdatesResponse;
}

export function projectConflictMetadataFromState(
  state: ProposalProjectStateResponse,
): ProposalProjectConflictMetadata {
  return {
    projectId: state.project.projectId,
    title: state.project.title,
    status: state.project.status,
    updatedAt: state.project.updatedAt,
    ...(state.project.updatedBy === undefined ? {} : { updatedBy: state.project.updatedBy }),
    currentVersionId: state.project.currentVersionId,
    currentVersionNumber: state.currentVersion.versionNumber,
    versionCount: state.project.versions.length,
  } satisfies ProposalProjectConflictMetadata;
}

export function summarizeProjectVersion(
  version: ProposalProjectVersion,
): ProposalProjectUpdatesResponse["latestVersion"] {
  return {
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    source: version.source,
    ...(version.label === undefined ? {} : { label: version.label }),
    ...(version.reason === undefined ? {} : { reason: version.reason }),
  } satisfies ProposalProjectUpdatesResponse["latestVersion"];
}

export function summarizeProjectArtifacts(
  project: Pick<ProposalProject, "artifacts">,
): ProposalProjectArtifactSummaryResponse {
  const artifacts = [...project.artifacts].sort(compareArtifactsNewestFirst);
  const latestArtifact = artifacts[0];
  const latestPdfArtifact = artifacts.find((artifact) => artifact.kind === "proposal-pdf");
  const latestPreviewArtifact = artifacts.find((artifact) => artifact.kind === "proposal-preview");

  return {
    artifactCount: project.artifacts.length,
    ...(latestArtifact === undefined ? {} : { latestArtifact }),
    ...(latestPdfArtifact === undefined ? {} : { latestPdfArtifact }),
    ...(latestPreviewArtifact === undefined ? {} : { latestPreviewArtifact }),
  } satisfies ProposalProjectArtifactSummaryResponse;
}

export function hasNewerProjectVersion(
  state: ProposalProjectStateResponse,
  update: ProposalProjectUpdatesResponse | null,
): boolean {
  if (update === null) return false;
  return update.latestProject.currentVersionId !== state.currentVersion.versionId;
}

export function latestVisibleArtifactSummary(
  state: ProposalProjectStateResponse,
  update: ProposalProjectUpdatesResponse | null,
): ProposalProjectArtifactSummaryResponse {
  return update?.artifactSummary ?? summarizeProjectArtifacts(state.project);
}

function compareArtifactsNewestFirst(
  left: ProposalArtifactMetadata,
  right: ProposalArtifactMetadata,
): number {
  const createdAt = right.createdAt.localeCompare(left.createdAt);
  if (createdAt !== 0) return createdAt;
  return right.artifactId.localeCompare(left.artifactId);
}
