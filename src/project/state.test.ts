import { describe, expect, it } from "vitest";
import { tritenExample } from "../data/defaults.js";
import { BUILT_IN_BRANDS } from "../proposal/brands.js";
import { proposalIntakeToDraft } from "../proposal/draftStore.js";
import type { ProposalBrand, ProposalDraft, ProposalIntake } from "../proposal/types.js";
import {
  addProposalArtifact,
  canonicalJson,
  closeDisposableAgentThread,
  commitProposalProjectVersion,
  createProposalAuthorMetadata,
  createProposalBrandSnapshot,
  createProposalProject,
  disposeDisposableAgentThread,
  getCurrentProjectSourceOfTruth,
  getCurrentProjectVersion,
  hashJson,
  hashProposalBrand,
  hashProposalSourceOfTruth,
  openDisposableAgentThread,
  toContentHash,
  toDisposableAgentThreadId,
  toProposalArtifactId,
  toProposalProjectId,
  toProposalProjectVersionId,
  validateProposalProject,
} from "./index.js";
import type { ProposalProject, ProposalProjectSourceOfTruth } from "./types.js";

const CREATED_AT = "2026-06-07T12:00:00.000Z";
const UPDATED_AT = "2026-06-07T13:00:00.000Z";

const HUMAN_AUTHOR = createProposalAuthorMetadata({
  authorId: "human-nolan",
  displayName: "Nolan Grout",
  kind: "human",
  email: "nolan@example.com",
});

const AGENT_AUTHOR = createProposalAuthorMetadata({
  authorId: "agent-scopeforge",
  displayName: "ScopeForge Agent",
  kind: "agent",
});

describe("project state hashes", () => {
  it("canonicalizes JSON object keys before hashing", () => {
    const left = { vendorBrand: { name: "Nolan", id: "nolan" }, draft: { title: "Pilot" } };
    const right = { draft: { title: "Pilot" }, vendorBrand: { id: "nolan", name: "Nolan" } };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(hashJson(left)).toBe(hashJson(right));
    expect(hashJson({ ...right, draft: { title: "Retitled pilot" } })).not.toBe(hashJson(left));
  });

  it("hashes only the structured draft and vendor/client brand source JSON", () => {
    const sourceOfTruth = validSourceOfTruth();
    const hashes = hashProposalSourceOfTruth(sourceOfTruth);

    expect(hashes.draftHash).toBe(hashJson(sourceOfTruth.draft));
    expect(hashes.vendorBrandHash).toBe(hashProposalBrand(sourceOfTruth.vendorBrand));
    expect(hashes.clientBrandHash).toBe(hashProposalBrand(sourceOfTruth.clientBrand));
    expect(hashes.sourceHash).toBe(hashJson(sourceOfTruth));
  });
});

describe("proposal project validation", () => {
  it("accepts a persisted project whose source of truth is draft plus vendor/client brand JSON", () => {
    const project = validProject();
    const currentVersion = requireCurrentVersion(project);

    expect(project.schemaVersion).toBe(1);
    expect(currentVersion.sourceOfTruth.draft.details.title).toBe(
      "AI Portfolio Intelligence Pilot",
    );
    expect(project.artifacts).toHaveLength(0);
    expect(project.brandSnapshots).toHaveLength(2);
    expect(validateProposalProject(project).ok).toBe(true);
  });

  it("rejects PDF-as-source fields and stale version hashes", () => {
    const project = validProject();
    const currentVersion = requireCurrentVersion(project);
    const invalid = {
      ...project,
      pdfUrl: "out/rendered-proposal.pdf",
      versions: [
        {
          ...currentVersion,
          sourceOfTruth: {
            ...currentVersion.sourceOfTruth,
            draft: {
              ...currentVersion.sourceOfTruth.draft,
              pdfUrl: "out/nested-rendered-proposal.pdf",
            },
          },
          hashes: {
            ...currentVersion.hashes,
            sourceHash: toContentHash(
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            ),
          },
        },
      ],
    };

    const result = validateProposalProject(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "pdfUrl" }),
          expect.objectContaining({ path: "versions[0].sourceOfTruth.draft.pdfUrl" }),
          expect.objectContaining({ path: "versions[0].hashes.sourceHash" }),
        ]),
      );
    }
  });

  it("requires rendered artifacts to point back to a known structured source version", () => {
    const project = validProject();
    const currentVersion = requireCurrentVersion(project);
    const withArtifact = addProposalArtifact(project, {
      artifactId: toProposalArtifactId("artifact-pdf-1"),
      kind: "proposal-pdf",
      origin: "render",
      uri: "out/triten-proposal.pdf",
      fileName: "triten-proposal.pdf",
      mimeType: "application/pdf",
      bytes: 42_000,
      createdAt: UPDATED_AT,
      createdBy: HUMAN_AUTHOR,
    });

    const artifact = withArtifact.artifacts[0];
    if (artifact === undefined) throw new Error("Expected artifact metadata.");

    expect(artifact.sourceVersionId).toBe(currentVersion.versionId);
    expect(artifact.sourceVersionHash).toBe(currentVersion.hashes.sourceHash);
    expect(validateProposalProject(withArtifact).ok).toBe(true);

    const invalid = {
      ...withArtifact,
      artifacts: [
        {
          ...artifact,
          sourceVersionId: toProposalProjectVersionId("version-missing"),
        },
      ],
    };
    const result = validateProposalProject(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "artifacts[0].sourceVersionId" })]),
      );
    }
  });
});

describe("proposal project helpers", () => {
  it("commits immutable source-of-truth versions without mutating older versions", () => {
    const project = validProject();
    const originalVersion = requireCurrentVersion(project);
    const revisedDraft: ProposalDraft = {
      ...originalVersion.sourceOfTruth.draft,
      details: {
        ...originalVersion.sourceOfTruth.draft.details,
        title: "Revised AI Portfolio Intelligence Pilot",
      },
    };

    const committed = commitProposalProjectVersion(project, {
      versionId: toProposalProjectVersionId("version-2-revised"),
      sourceOfTruth: {
        ...originalVersion.sourceOfTruth,
        draft: revisedDraft,
      },
      createdAt: UPDATED_AT,
      createdBy: HUMAN_AUTHOR,
      label: "Retitle proposal",
      reason: "Client-facing title tightened after review.",
    });
    const committedVersion = requireCurrentVersion(committed);

    expect(committed).not.toBe(project);
    expect(project.currentVersionId).toBe(originalVersion.versionId);
    expect(requireCurrentVersion(project).sourceOfTruth.draft.details.title).toBe(
      "AI Portfolio Intelligence Pilot",
    );
    expect(committedVersion.versionNumber).toBe(2);
    expect(committedVersion.parentVersionId).toBe(originalVersion.versionId);
    expect(committedVersion.sourceOfTruth.draft.details.title).toBe(
      "Revised AI Portfolio Intelligence Pilot",
    );
    expect(committedVersion.hashes.sourceHash).not.toBe(originalVersion.hashes.sourceHash);
    expect(validateProposalProject(committed).ok).toBe(true);
  });

  it("captures brand snapshots, disposable agent threads, and artifact metadata", () => {
    const project = validProject();
    const currentVersion = requireCurrentVersion(project);
    const snapshot = createProposalBrandSnapshot({
      role: "vendor",
      brand: BUILT_IN_BRANDS.nolan,
      capturedAt: CREATED_AT,
      capturedBy: HUMAN_AUTHOR,
      sourceVersionId: currentVersion.versionId,
    });

    expect(snapshot.brandHash).toBe(hashProposalBrand(BUILT_IN_BRANDS.nolan));

    const threadId = toDisposableAgentThreadId("thread-agent-disposable");
    const opened = openDisposableAgentThread(project, {
      threadId,
      createdAt: UPDATED_AT,
      createdBy: AGENT_AUTHOR,
      title: "Explore alternate scope",
      objective: "Try a smaller pilot, then discard if it does not improve payback.",
    });
    const withArtifact = addProposalArtifact(opened, {
      artifactId: toProposalArtifactId("artifact-preview-html"),
      kind: "proposal-html",
      origin: "agent",
      uri: "memory://preview/thread-agent-disposable.html",
      createdAt: UPDATED_AT,
      createdBy: AGENT_AUTHOR,
      threadId,
    });
    const closed = closeDisposableAgentThread(withArtifact, threadId, {
      closedAt: UPDATED_AT,
      artifactIds: [toProposalArtifactId("artifact-preview-html")],
    });
    const disposed = disposeDisposableAgentThread(closed, threadId, {
      disposedAt: UPDATED_AT,
      disposalReason: "Exploration was not promoted to a durable project version.",
    });

    expect(opened.agentThreads[0]?.status).toBe("open");
    expect(withArtifact.agentThreads[0]?.artifactIds).toEqual([
      toProposalArtifactId("artifact-preview-html"),
    ]);
    expect(closed.agentThreads[0]?.status).toBe("closed");
    expect(disposed.agentThreads[0]?.status).toBe("discarded");
    expect(disposed.agentThreads[0]?.disposalReason).toMatch(/not promoted/);
    expect(validateProposalProject(disposed).ok).toBe(true);
  });

  it("returns the current structured source of truth", () => {
    const project = validProject();
    const sourceOfTruth = getCurrentProjectSourceOfTruth(project);

    expect(sourceOfTruth?.draft.metadata.draftId).toBe("draft-triten-2026-06-07");
    expect(sourceOfTruth?.vendorBrand.id).toBe("nolan");
    expect(sourceOfTruth?.clientBrand.id).toBe("triten");
  });
});

function validProject(): ProposalProject {
  return createProposalProject({
    projectId: toProposalProjectId("project-triten-pilot"),
    versionId: toProposalProjectVersionId("version-1-initial"),
    sourceOfTruth: validSourceOfTruth(),
    createdAt: CREATED_AT,
    createdBy: HUMAN_AUTHOR,
    label: "Initial structured proposal project",
  });
}

function validSourceOfTruth(): ProposalProjectSourceOfTruth {
  return {
    draft: validDraft(),
    vendorBrand: BUILT_IN_BRANDS.nolan,
    clientBrand: clientBrand(),
  } satisfies ProposalProjectSourceOfTruth;
}

function requireCurrentVersion(project: ProposalProject) {
  const currentVersion = getCurrentProjectVersion(project);
  if (currentVersion === null) throw new Error("Expected current project version.");
  return currentVersion;
}

function validDraft(): ProposalDraft {
  return proposalIntakeToDraft(validIntake(), {
    draftId: "draft-triten-2026-06-07",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    author: HUMAN_AUTHOR.displayName,
    source: "project-state-test",
    footerContact: "hello@nolango.com",
    paymentTerms: "50% to start, 50% at pilot handoff.",
  });
}

function validIntake(): ProposalIntake {
  return {
    project: tritenExample(),
    preparedFor: {
      companyName: "Triten Real Estate Partners",
      buyerName: "Triten Leadership Team",
      buyerTitle: "COO",
      website: "https://triten.com",
      logoText: "TRITEN",
      accentColor: "#0f766e",
    },
    details: {
      title: "AI Portfolio Intelligence Pilot",
      subtitle:
        "A focused pilot to unify Monday.com and Power BI context into an executive Q&A layer.",
      date: "2026-06-07",
      recommendation:
        "Start with the $40K pilot build, then scope workflow agents after the data foundation proves out.",
      executiveSummary: [
        "Triten has enough manual reporting and cross-system lookup pain to justify a focused AI data pilot.",
      ],
      whatWeHeard: [
        "Teams spend recurring time pulling portfolio context across multiple systems.",
      ],
      investmentSummary: "The recommended pilot is priced at $40K.",
      timelineSummary: "Pilot delivery is expected across four focused phases.",
    },
    scope: [
      {
        title: "Data foundation and reconciliation",
        description: "Create the trusted operating layer needed for AI-assisted portfolio answers.",
        deliverables: ["Source mapping", "Power BI and Monday.com ingestion"],
        outcomes: ["One governed foundation for pilot Q&A"],
      },
    ],
    milestones: [
      {
        name: "Discovery and source map",
        timing: "Week 1",
        outcomes: ["Confirm data owners", "Lock pilot questions"],
      },
    ],
    assumptions: ["Triten provides timely access to source-system owners."],
    exclusions: ["Full accounting automation is deferred to a later phase."],
    clientInputs: ["Power BI workspace access", "Monday.com board access"],
    nextSteps: ["Approve pilot scope", "Schedule source-system kickoff"],
  };
}

function clientBrand(): ProposalBrand {
  return {
    id: "triten",
    name: "Triten Real Estate Partners",
    legalName: "Triten Real Estate Partners",
    tagline: "Real estate investment and development.",
    website: "https://triten.com",
    logoText: "TRITEN",
    colors: {
      primary: "#0f172a",
      secondary: "#334155",
      accent: "#0f766e",
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#111827",
      mutedText: "#64748b",
      border: "#dbe3ef",
    },
  } satisfies ProposalBrand;
}
