import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { tritenExample } from "../data/defaults.js";
import { BUILT_IN_BRANDS } from "../proposal/brands.js";
import { proposalIntakeToDraft } from "../proposal/draftStore.js";
import type { ProposalBrand, ProposalDraft, ProposalIntake } from "../proposal/types.js";
import {
  createProposalAuthorMetadata,
  getCurrentProjectVersion,
  toProposalProjectId,
  toProposalProjectVersionId,
} from "./state.js";
import {
  createLocalProposalProjectStore,
  PROJECT_RECORD_FILE_NAME,
  PROJECT_VERSIONS_DIRECTORY_NAME,
  projectDirectory,
  type LocalProposalProjectStore,
} from "./store.node.js";
import type { ProposalProject, ProposalProjectSourceOfTruth } from "./types.js";

const INITIAL_TIME = "2026-06-07T12:00:00.000Z";
const UPDATED_TIME = "2026-06-07T13:00:00.000Z";

const HUMAN_AUTHOR = createProposalAuthorMetadata({
  authorId: "human-nolan",
  displayName: "Nolan Grout",
  kind: "human",
  email: "nolan@example.com",
});

describe("local proposal project store", () => {
  it("creates project records and immutable version JSON files", async () => {
    await withTempStore([INITIAL_TIME], async ({ store, dataDir }) => {
      const project = await store.create({
        sourceOfTruth: validSourceOfTruth(),
        createdBy: HUMAN_AUTHOR,
        title: "Triten collaborative proposal",
        label: "Initial version",
      });
      const currentVersion = requireCurrentVersion(project);
      const projectPath = join(
        projectDirectory(dataDir, project.projectId),
        PROJECT_RECORD_FILE_NAME,
      );
      const versionPath = join(
        projectDirectory(dataDir, project.projectId),
        PROJECT_VERSIONS_DIRECTORY_NAME,
        `000001-${currentVersion.versionId}.json`,
      );

      expect(project.projectId).toBe(toProposalProjectId("project-1"));
      expect(project.currentVersionId).toBe(toProposalProjectVersionId("version-1-1"));
      expect(project.createdAt).toBe(INITIAL_TIME);
      expect(project.versions).toHaveLength(1);
      expect(store.list()).toEqual([
        {
          projectId: project.projectId,
          title: "Triten collaborative proposal",
          status: "active",
          createdAt: INITIAL_TIME,
          updatedAt: INITIAL_TIME,
          createdBy: HUMAN_AUTHOR,
          currentVersionId: currentVersion.versionId,
          versionCount: 1,
        },
      ]);
      expect(JSON.parse(await readFile(projectPath, "utf8"))).toMatchObject({
        projectId: "project-1",
        currentVersionId: "version-1-1",
      });
      expect(JSON.parse(await readFile(versionPath, "utf8"))).toMatchObject({
        versionId: "version-1-1",
        versionNumber: 1,
      });
    });
  });

  it("reloads saved projects from disk", async () => {
    await withTempStore([INITIAL_TIME], async ({ store, dataDir }) => {
      const created = await store.create({
        sourceOfTruth: validSourceOfTruth(),
        createdBy: HUMAN_AUTHOR,
      });
      const reloaded = testStore(dataDir, [UPDATED_TIME]);

      const load = await reloaded.load();
      const project = reloaded.get(created.projectId);

      expect(load.ok).toBe(true);
      expect(reloaded.list()).toHaveLength(1);
      expect(project?.projectId).toBe(created.projectId);
      expect(requireCurrentVersion(project).sourceOfTruth.draft.details.title).toBe(
        "AI Portfolio Intelligence Pilot",
      );
    });
  });

  it("appends immutable versions and reloads the latest version after a restart", async () => {
    await withTempStore([INITIAL_TIME, UPDATED_TIME], async ({ store, dataDir }) => {
      const created = await store.create({
        sourceOfTruth: validSourceOfTruth(),
        createdBy: HUMAN_AUTHOR,
      });
      const initialVersion = requireCurrentVersion(created);
      const revised = await store.update(created.projectId, {
        sourceOfTruth: retitledSourceOfTruth("Revised AI Portfolio Intelligence Pilot"),
        createdBy: HUMAN_AUTHOR,
        parentVersionId: initialVersion.versionId,
        label: "Retitle proposal",
        reason: "Client-facing title tightened after review.",
      });

      expect(revised).not.toBeNull();
      const updated = requireProject(revised);
      const currentVersion = requireCurrentVersion(updated);
      expect(updated.versions).toHaveLength(2);
      expect(updated.currentVersionId).toBe(toProposalProjectVersionId("version-2-2"));
      expect(currentVersion.versionNumber).toBe(2);
      expect(currentVersion.parentVersionId).toBe(initialVersion.versionId);
      expect(updated.versions[0]?.sourceOfTruth.draft.details.title).toBe(
        "AI Portfolio Intelligence Pilot",
      );

      const reloaded = testStore(dataDir, ["2026-06-07T14:00:00.000Z"]);
      const load = await reloaded.load();
      const persisted = reloaded.get(created.projectId);
      const persistedCurrent = requireCurrentVersion(persisted);

      expect(load.ok).toBe(true);
      expect(persisted?.versions).toHaveLength(2);
      expect(persisted?.currentVersionId).toBe(currentVersion.versionId);
      expect(persistedCurrent.sourceOfTruth.draft.details.title).toBe(
        "Revised AI Portfolio Intelligence Pilot",
      );
    });
  });

  it("prevents two partners who started from the same version from overwriting each other", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "scopeforge-project-store-partners-"));
    try {
      const partnerOne = testStore(dataDir, [INITIAL_TIME, UPDATED_TIME]);
      const created = await partnerOne.create({
        sourceOfTruth: validSourceOfTruth(),
        createdBy: HUMAN_AUTHOR,
      });
      const baseVersion = requireCurrentVersion(created);

      const partnerTwo = testStore(dataDir, ["2026-06-07T13:30:00.000Z"]);
      const load = await partnerTwo.load();
      expect(load.ok).toBe(true);
      expect(partnerTwo.get(created.projectId)?.currentVersionId).toBe(baseVersion.versionId);

      const firstSave = await partnerOne.update(created.projectId, {
        sourceOfTruth: retitledSourceOfTruth("Partner One AI Portfolio Intelligence Pilot"),
        createdBy: HUMAN_AUTHOR,
        parentVersionId: baseVersion.versionId,
        label: "Partner one update",
      });
      const firstSavedProject = requireProject(firstSave);
      const firstSavedVersion = requireCurrentVersion(firstSavedProject);

      expect(firstSavedVersion.parentVersionId).toBe(baseVersion.versionId);
      expect(firstSavedVersion.sourceOfTruth.draft.details.title).toBe(
        "Partner One AI Portfolio Intelligence Pilot",
      );

      await expect(
        partnerTwo.update(created.projectId, {
          sourceOfTruth: retitledSourceOfTruth("Partner Two Stale AI Portfolio Intelligence Pilot"),
          createdBy: HUMAN_AUTHOR,
          parentVersionId: baseVersion.versionId,
          label: "Partner two stale update",
        }),
      ).rejects.toMatchObject({
        code: "base_version_conflict",
        providedBaseVersionId: baseVersion.versionId,
        latestProject: expect.objectContaining({
          projectId: created.projectId,
          currentVersionId: firstSavedVersion.versionId,
          currentVersionNumber: 2,
          versionCount: 2,
        }),
      });

      expect(
        requireCurrentVersion(partnerOne.get(created.projectId)).sourceOfTruth.draft.details.title,
      ).toBe("Partner One AI Portfolio Intelligence Pilot");
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("returns null for missing projects", async () => {
    await withTempStore([INITIAL_TIME], async ({ store }) => {
      const missingProjectId = toProposalProjectId("project-missing");
      await store.load();

      expect(store.get(missingProjectId)).toBeNull();
      await expect(
        store.update(missingProjectId, {
          sourceOfTruth: validSourceOfTruth(),
          createdBy: HUMAN_AUTHOR,
        }),
      ).resolves.toBeNull();
    });
  });

  it("reports corrupted project JSON without loading the bad record", async () => {
    await withTempStore([INITIAL_TIME], async ({ store, dataDir }) => {
      const project = await store.create({
        sourceOfTruth: validSourceOfTruth(),
        createdBy: HUMAN_AUTHOR,
      });
      const projectPath = join(
        projectDirectory(dataDir, project.projectId),
        PROJECT_RECORD_FILE_NAME,
      );
      await writeFile(projectPath, "{not valid json", "utf8");

      const reloaded = testStore(dataDir, [UPDATED_TIME]);
      const load = await reloaded.load();

      expect(load.ok).toBe(false);
      if (load.ok) throw new Error("Expected corrupted JSON to fail load.");
      expect(load.projects).toEqual([]);
      expect(load.errors).toEqual([
        expect.objectContaining({
          code: "project_json_corrupt",
          path: projectPath,
        }),
      ]);
      expect(reloaded.get(project.projectId)).toBeNull();
    });
  });
});

interface TempStoreContext {
  readonly store: LocalProposalProjectStore;
  readonly dataDir: string;
}

async function withTempStore(
  times: readonly string[],
  run: (context: TempStoreContext) => Promise<void>,
): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "scopeforge-project-store-"));
  try {
    await run({ store: testStore(dataDir, times), dataDir });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function testStore(dataDir: string, times: readonly string[]): LocalProposalProjectStore {
  let projectCounter = 0;
  let versionCounter = 0;
  let timeIndex = 0;
  return createLocalProposalProjectStore({
    dataDir,
    now: () => {
      const fallback = times[times.length - 1] ?? INITIAL_TIME;
      const value = times[timeIndex] ?? fallback;
      timeIndex += 1;
      return value;
    },
    projectIdFactory: () => {
      projectCounter += 1;
      return toProposalProjectId(`project-${projectCounter}`);
    },
    versionIdFactory: ({ versionNumber }) => {
      versionCounter += 1;
      return toProposalProjectVersionId(`version-${versionNumber}-${versionCounter}`);
    },
  });
}

function retitledSourceOfTruth(title: string): ProposalProjectSourceOfTruth {
  const sourceOfTruth = validSourceOfTruth();
  const draft: ProposalDraft = {
    ...sourceOfTruth.draft,
    details: {
      ...sourceOfTruth.draft.details,
      title,
    },
  };
  return { ...sourceOfTruth, draft } satisfies ProposalProjectSourceOfTruth;
}

function validSourceOfTruth(): ProposalProjectSourceOfTruth {
  return {
    draft: validDraft(),
    vendorBrand: BUILT_IN_BRANDS.nolan,
    clientBrand: clientBrand(),
  } satisfies ProposalProjectSourceOfTruth;
}

function validDraft(): ProposalDraft {
  return proposalIntakeToDraft(validIntake(), {
    draftId: "draft-triten-2026-06-07",
    createdAt: INITIAL_TIME,
    updatedAt: INITIAL_TIME,
    author: HUMAN_AUTHOR.displayName,
    source: "project-store-test",
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
  } satisfies ProposalIntake;
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

function requireCurrentVersion(
  project: ProposalProject | null,
): ProposalProject["versions"][number] {
  if (project === null) throw new Error("Expected proposal project.");
  const version = getCurrentProjectVersion(project);
  if (version === null) throw new Error("Expected current project version.");
  return version;
}

function requireProject(project: ProposalProject | null): ProposalProject {
  if (project === null) throw new Error("Expected proposal project.");
  return project;
}
