import { describe, expect, it } from "vitest";
import { tritenExample } from "../data/defaults.js";
import {
  canRedoDraft,
  canUndoDraft,
  createProposalDraftStoreFromIntake,
  getDraftVersion,
  proposalIntakeToDraft,
  redoDraft,
  switchDraftTemplate,
  undoDraft,
  updateDraftDetails,
  updateDraftPricingPhase,
  updateDraftValueSource,
} from "./draftStore.js";
import { validateProposalDraft } from "./schema.js";
import type { ProposalIntake } from "./types.js";

describe("proposalIntakeToDraft", () => {
  it("converts current ProposalIntake examples into validated draft state", () => {
    const intake = validIntake();
    const draft = proposalIntakeToDraft(intake, {
      createdAt: "2026-06-05T12:00:00Z",
      updatedAt: "2026-06-05T12:00:00Z",
      author: "Nolan Grout",
    });

    expect(draft.metadata).toEqual(
      expect.objectContaining({
        draftId: "draft-triten-real-estate-partners-ai-portfolio-intelligence-pilot",
        version: 1,
        status: "draft",
        source: "proposal-intake",
      }),
    );
    expect(draft.templateIds).toEqual(["generic/value-proposal"]);
    expect(draft.actualDeliverables[0]?.title).toBe(intake.scope[0]?.title);
    expect(draft.buildPlan[0]?.name).toBe(intake.milestones[0]?.name);
    expect(draft.pricing.phases[0]).toEqual(
      expect.objectContaining({ name: "Pilot Build", price: 40_000 }),
    );
    expect(draft.valueProposal.valueSources.map((row) => row.label)).toEqual(
      expect.arrayContaining(["Investor-report assembly", "Analysts & associates time recovery"]),
    );

    expect(validateProposalDraft(draft).ok).toBe(true);
  });
});

describe("proposal draft store", () => {
  it("versions immutable structured updates", () => {
    const store = createProposalDraftStoreFromIntake(validIntake(), {
      createdAt: "2026-06-05T12:00:00Z",
    });
    const updated = updateDraftDetails(
      store,
      { title: "Revised AI Portfolio Intelligence Pilot" },
      { label: "Retitle proposal", updatedAt: "2026-06-05T13:00:00Z" },
    );
    const repriced = updateDraftPricingPhase(
      updated,
      0,
      { price: 45_000, note: "Updated after stakeholder review." },
      { label: "Update pilot price", updatedAt: "2026-06-05T14:00:00Z" },
    );
    const valueUpdated = updateDraftValueSource(
      repriced,
      0,
      { confidence: "high", annualValue: { low: 55_000, high: 95_000 } },
      { label: "Tighten value source" },
    );

    expect(store.current.metadata.version).toBe(1);
    expect(store.current.details.title).toBe("AI Portfolio Intelligence Pilot");
    expect(updated.current.metadata.version).toBe(2);
    expect(updated.current.details.title).toBe("Revised AI Portfolio Intelligence Pilot");
    expect(updated.current.project).toBe(store.current.project);
    expect(updated.current.details).not.toBe(store.current.details);

    expect(repriced.current.metadata.version).toBe(3);
    expect(repriced.current.pricing.phases[0]).toEqual(
      expect.objectContaining({ price: 45_000, note: "Updated after stakeholder review." }),
    );
    expect(updated.current.pricing.phases[0]?.price).toBe(40_000);
    expect(repriced.current.pricing.phases[1]).toBe(updated.current.pricing.phases[1]);

    expect(valueUpdated.current.metadata.version).toBe(4);
    expect(valueUpdated.current.valueProposal.valueSources[0]).toEqual(
      expect.objectContaining({ confidence: "high", annualValue: { low: 55_000, high: 95_000 } }),
    );
    expect(repriced.current.valueProposal.valueSources[0]?.confidence).toBe("medium");
    expect(valueUpdated.history.map((version) => version.label)).toEqual([
      "Converted from ProposalIntake",
      "Retitle proposal",
      "Update pilot price",
      "Tighten value source",
    ]);
  });

  it("supports undo, redo, and branched history without reusing version numbers", () => {
    const store = createProposalDraftStoreFromIntake(validIntake());
    const retitled = updateDraftDetails(store, { title: "Version two" }, { label: "Retitle" });
    const repriced = updateDraftPricingPhase(retitled, 0, { price: 45_000 }, { label: "Reprice" });

    expect(canUndoDraft(repriced)).toBe(true);
    expect(canRedoDraft(repriced)).toBe(false);

    const undone = undoDraft(repriced);
    expect(undone.current.metadata.version).toBe(2);
    expect(undone.current.details.title).toBe("Version two");
    expect(undone.current.pricing.phases[0]?.price).toBe(40_000);
    expect(canRedoDraft(undone)).toBe(true);

    const redone = redoDraft(undone);
    expect(redone.current.metadata.version).toBe(3);
    expect(redone.current.pricing.phases[0]?.price).toBe(45_000);

    const branched = updateDraftDetails(
      undone,
      { subtitle: "Branched after undo" },
      { label: "Branch" },
    );
    expect(branched.current.metadata.version).toBe(4);
    expect(branched.history.map((version) => version.version)).toEqual([1, 2, 4]);
    expect(getDraftVersion(branched, 3)).toBeNull();
    expect(canRedoDraft(branched)).toBe(false);
  });

  it("switches draft templates through the same immutable history path", () => {
    const store = createProposalDraftStoreFromIntake(validIntake());
    const switched = switchDraftTemplate(store, "generic/scope-review", {
      label: "Switch to scope review",
    });
    const unchanged = switchDraftTemplate(switched, "generic/scope-review");

    expect(switched.current.metadata.version).toBe(2);
    expect(switched.current.templateIds).toEqual(["generic/scope-review"]);
    expect(store.current.templateIds).toEqual(["generic/value-proposal"]);
    expect(unchanged).toBe(switched);
    expect(validateProposalDraft(switched.current).ok).toBe(true);
  });
});

function validIntake(): ProposalIntake {
  const project = tritenExample();
  return {
    project,
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
      date: "2026-06-05",
      recommendation:
        "Start with the $40K pilot build, then scope workflow agents after the data foundation proves out.",
      executiveSummary: [
        "Triten has enough manual reporting and cross-system lookup pain to justify a focused AI data pilot.",
        "The first phase should prove value through a reliable data foundation before broader automation.",
      ],
      whatWeHeard: [
        "Teams spend recurring time pulling context across multiple systems.",
        "Leadership wants faster answers without another ungoverned reporting surface.",
      ],
      investmentSummary: "The recommended pilot is priced at $40K.",
      timelineSummary: "Pilot delivery is expected across four focused phases.",
    },
    scope: [
      {
        title: "Data foundation and reconciliation",
        description: "Create the trusted operating layer needed for AI-assisted portfolio answers.",
        deliverables: [
          "Source mapping",
          "Power BI and Monday.com ingestion",
          "Reconciliation checks",
        ],
        outcomes: ["One governed foundation for pilot Q&A"],
      },
      {
        title: "Q&A pilot experience",
        description: "Build the bounded Q&A workflow for priority operating questions.",
        deliverables: ["MCP-backed Q&A workflow", "Prompt and response guardrails"],
        outcomes: ["Pilot users can answer approved questions from governed data."],
      },
    ],
    milestones: [
      {
        name: "Discovery and source map",
        timing: "Week 1",
        outcomes: ["Confirm data owners", "Lock pilot questions"],
      },
      {
        name: "Pilot build and handoff",
        timing: "Weeks 2–4",
        outcomes: ["Deliver working Q&A layer", "Train internal owners"],
      },
    ],
    assumptions: ["Triten provides timely access to source-system owners."],
    exclusions: ["Full accounting automation is deferred to a later phase."],
    clientInputs: ["Power BI workspace access", "Monday.com board access"],
    nextSteps: ["Approve pilot scope", "Schedule source-system kickoff"],
  };
}
