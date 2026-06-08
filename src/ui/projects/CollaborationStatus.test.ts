import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createProposalAuthorMetadata } from "../../project/state.js";
import { PROPOSAL_PROJECT_SCHEMA_VERSION } from "../../project/types.js";
import type {
  ContentHash,
  ProposalArtifactId,
  ProposalArtifactMetadata,
  ProposalProject,
  ProposalProjectId,
  ProposalProjectSourceOfTruth,
  ProposalProjectVersion,
  ProposalProjectVersionId,
} from "../../project/types.js";
import { CollaborationStatus } from "./CollaborationStatus.js";
import type { ProposalProjectStateResponse, ProposalProjectUpdatesResponse } from "../lib/api.js";
import type { ProjectConflictNotice } from "../lib/collaboration.js";

const partnerOne = createProposalAuthorMetadata({
  authorId: "partner-1",
  displayName: "Partner One",
  kind: "human",
});

const partnerTwo = createProposalAuthorMetadata({
  authorId: "partner-2",
  displayName: "Partner Two",
  kind: "human",
});

describe("CollaborationStatus", () => {
  it("renders conflict display with the latest editor and refresh action", () => {
    const state = projectState(2, partnerOne.displayName);
    const update = projectUpdate(3);
    const conflict: ProjectConflictNotice = {
      action: "save",
      message: "Project has changed since the provided baseVersionId.",
      latestProject: update.latestProject,
      occurredAt: "2026-06-07T14:00:00.000Z",
    };

    const html = renderToStaticMarkup(
      createElement(CollaborationStatus, {
        state,
        update,
        conflict,
        refreshing: false,
        onRefreshLatest: vi.fn(),
      }),
    );

    expect(html).toContain("Viewing v2");
    expect(html).toContain("Latest v3");
    expect(html).toContain("Last editor: Partner Two");
    expect(html).toContain("Conflict during save");
    expect(html).toContain("Refresh to latest");
  });

  it("shows a refresh-to-latest prompt when mocked polling data reports a newer version", () => {
    const state = projectState(2, partnerOne.displayName);
    const update = projectUpdate(3);

    const html = renderToStaticMarkup(
      createElement(CollaborationStatus, {
        state,
        update,
        conflict: null,
        refreshing: false,
        onRefreshLatest: vi.fn(),
      }),
    );

    expect(html).toContain("Another collaborator saved v3 by Partner Two");
    expect(html).toContain("Refresh to latest");
    expect(html).toContain("Exported by Partner Two");
  });
});

function projectState(versionNumber: number, displayName: string): ProposalProjectStateResponse {
  const version = projectVersion(versionNumber, displayName);
  const project = {
    schemaVersion: PROPOSAL_PROJECT_SCHEMA_VERSION,
    projectId: projectId("project-1"),
    title: "Acme AI pilot",
    status: "active",
    createdAt: "2026-06-07T12:00:00.000Z",
    updatedAt: version.createdAt,
    createdBy: partnerOne,
    currentVersionId: version.versionId,
    versions: [version],
    brandSnapshots: [],
    agentThreads: [],
    artifacts: [],
    updatedBy: version.createdBy,
  } satisfies ProposalProject;

  return {
    ok: true,
    project,
    currentVersion: version,
    sourceOfTruth: version.sourceOfTruth,
  } satisfies ProposalProjectStateResponse;
}

function projectUpdate(versionNumber: number): ProposalProjectUpdatesResponse {
  const version = projectVersion(versionNumber, partnerTwo.displayName);
  return {
    ok: true,
    projectId: "project-1",
    latestProject: {
      projectId: projectId("project-1"),
      title: "Acme AI pilot",
      status: "active",
      updatedAt: version.createdAt,
      updatedBy: partnerTwo,
      currentVersionId: version.versionId,
      currentVersionNumber: version.versionNumber,
      versionCount: version.versionNumber,
    },
    latestVersion: {
      versionId: version.versionId,
      versionNumber: version.versionNumber,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
      source: version.source,
    },
    artifactSummary: {
      artifactCount: 1,
      latestPdfArtifact: pdfArtifact(version.versionId),
    },
  } satisfies ProposalProjectUpdatesResponse;
}

function projectVersion(versionNumber: number, displayName: string): ProposalProjectVersion {
  const author = displayName === partnerOne.displayName ? partnerOne : partnerTwo;
  const versionId = `version-${versionNumber}`;
  return {
    versionId: proposalVersionId(versionId),
    versionNumber,
    ...(versionNumber === 1
      ? {}
      : { parentVersionId: proposalVersionId(`version-${versionNumber - 1}`) }),
    createdAt: `2026-06-07T1${versionNumber}:00:00.000Z`,
    createdBy: author,
    source: "human-edit",
    sourceOfTruth: {} as ProposalProjectSourceOfTruth,
    hashes: {
      draftHash: contentHash(`sha256:draft-${versionNumber}`),
      vendorBrandHash: contentHash(`sha256:vendor-${versionNumber}`),
      clientBrandHash: contentHash(`sha256:client-${versionNumber}`),
      sourceHash: contentHash(`sha256:source-${versionNumber}`),
    },
  } satisfies ProposalProjectVersion;
}

function pdfArtifact(versionId: ProposalProjectVersionId): ProposalArtifactMetadata {
  return {
    artifactId: artifactId("artifact-pdf-1"),
    kind: "proposal-pdf",
    origin: "render",
    uri: "artifacts/version-3/acme.pdf",
    createdAt: "2026-06-07T14:05:00.000Z",
    createdBy: partnerTwo,
    sourceVersionId: versionId,
    sourceVersionHash: contentHash("sha256:source-3"),
    fileName: "acme.pdf",
    mimeType: "application/pdf",
    bytes: 123,
  } satisfies ProposalArtifactMetadata;
}

function projectId(value: string): ProposalProjectId {
  return value as ProposalProjectId;
}

function proposalVersionId(value: string): ProposalProjectVersionId {
  return value as ProposalProjectVersionId;
}

function artifactId(value: string): ProposalArtifactId {
  return value as ProposalArtifactId;
}

function contentHash(value: string): ContentHash {
  return value as ContentHash;
}
