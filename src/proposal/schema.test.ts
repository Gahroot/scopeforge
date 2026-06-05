import { describe, expect, it } from "vitest";
import { tritenExample } from "../data/defaults.js";
import { proposalDraftToIntake, validateProposalDraft, validateProposalIntake } from "./schema.js";
import type { ProposalDraft, ProposalIntake } from "./types.js";

describe("validateProposalIntake", () => {
  it("accepts a complete intake", () => {
    const result = validateProposalIntake(validIntake());

    expect(result.ok).toBe(true);
  });

  it("rejects missing prepared-for metadata and narrative arrays", () => {
    const intake = validIntake();
    const result = validateProposalIntake({
      ...intake,
      preparedFor: {
        ...intake.preparedFor,
        companyName: "",
      },
      details: {
        ...intake.details,
        executiveSummary: [],
        whatWeHeard: [""],
      },
      scope: [
        {
          ...intake.scope[0],
          deliverables: [],
        },
      ],
      nextSteps: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "preparedFor.companyName" }),
          expect.objectContaining({ path: "details.executiveSummary" }),
          expect.objectContaining({ path: "details.whatWeHeard[0]" }),
          expect.objectContaining({ path: "scope[0].deliverables" }),
          expect.objectContaining({ path: "nextSteps" }),
        ]),
      );
    }
  });

  it("rejects incomplete pricing, value, and scope inputs", () => {
    const intake = validIntake();
    const result = validateProposalIntake({
      ...intake,
      project: {
        ...intake.project,
        cost: {
          ...intake.project.cost,
          workstreams: [],
        },
        value: {
          ...intake.project.value,
          segments: [],
          workflows: [],
        },
        pricing: {
          ...intake.project.pricing,
          tiers: [{ name: "Phase 2", price: null }],
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "project.cost.workstreams" }),
          expect.objectContaining({ path: "project.value" }),
          expect.objectContaining({ path: "project.pricing.tiers" }),
        ]),
      );
    }
  });
});

describe("validateProposalDraft", () => {
  it("accepts a conversational value-proposal draft", () => {
    const result = validateProposalDraft(validDraft());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.templateIds).toContain("generic/value-proposal");
      expect(result.value.valueProposal.unlocks).toContain(
        "A governed Q&A layer for portfolio questions.",
      );
    }
  });

  it("returns nested path-based errors for incomplete draft fields", () => {
    const draft = validDraft();
    const firstValueSource = draft.valueProposal.valueSources[0];
    const firstBuildStep = draft.buildPlan[0];
    const firstDeliverable = draft.actualDeliverables[0];
    const firstPhase = draft.pricing.phases[0];
    if (
      firstValueSource === undefined ||
      firstBuildStep === undefined ||
      firstDeliverable === undefined ||
      firstPhase === undefined
    ) {
      throw new Error("Draft fixture is missing a required row.");
    }

    const result = validateProposalDraft({
      ...draft,
      templateIds: ["custom/unknown"],
      metadata: {
        ...draft.metadata,
        version: 0,
      },
      valueProposal: {
        ...draft.valueProposal,
        unlocks: [],
        valueSources: [
          {
            ...firstValueSource,
            annualValue: { low: 20_000, high: 10_000 },
            confidence: "certain",
          },
        ],
        sixMonthSavings: { low: -1, high: 20_000 },
        annualValueTarget: 0,
      },
      buildPlan: [
        {
          ...firstBuildStep,
          activities: [""],
        },
      ],
      actualDeliverables: [
        {
          ...firstDeliverable,
          included: [],
        },
      ],
      pricing: {
        ...draft.pricing,
        phases: [
          {
            ...firstPhase,
            price: null,
            discounts: [{ label: "", amount: -5 }],
          },
        ],
      },
      terms: {
        ...draft.terms,
        paymentTerms: "",
        clientResponsibilities: [""],
      },
      footer: {
        ...draft.footer,
        confidentiality: "",
      },
      nextSteps: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "templateIds[0]" }),
          expect.objectContaining({ path: "metadata.version" }),
          expect.objectContaining({ path: "valueProposal.unlocks" }),
          expect.objectContaining({ path: "valueProposal.valueSources[0].annualValue" }),
          expect.objectContaining({ path: "valueProposal.valueSources[0].confidence" }),
          expect.objectContaining({ path: "valueProposal.sixMonthSavings.low" }),
          expect.objectContaining({ path: "valueProposal.annualValueTarget" }),
          expect.objectContaining({ path: "buildPlan[0].activities[0]" }),
          expect.objectContaining({ path: "actualDeliverables[0].included" }),
          expect.objectContaining({ path: "pricing.phases" }),
          expect.objectContaining({ path: "pricing.phases[0].discounts[0].label" }),
          expect.objectContaining({ path: "pricing.phases[0].discounts[0].amount" }),
          expect.objectContaining({ path: "terms.paymentTerms" }),
          expect.objectContaining({ path: "terms.clientResponsibilities[0]" }),
          expect.objectContaining({ path: "footer.confidentiality" }),
          expect.objectContaining({ path: "nextSteps" }),
        ]),
      );
    }
  });

  it("converts a draft into the legacy proposal intake shape", () => {
    const draft = validDraft();
    const intake = proposalDraftToIntake(draft);
    const result = validateProposalIntake(intake);

    expect(result.ok).toBe(true);
    expect(intake.scope[0]?.title).toBe("Governed portfolio Q&A pilot");
    expect(intake.scope[0]?.deliverables).toEqual([
      "MCP-backed Q&A workflow for priority operating questions.",
      "Prompt and response guardrails for pilot users.",
    ]);
    expect(intake.milestones[0]?.name).toBe("Source map and pilot question design");
    expect(intake.assumptions).toEqual(draft.terms.assumptions);
    expect(intake.clientInputs).toEqual(draft.terms.clientResponsibilities);
    expect(intake.project.pricing.tiers[0]).toEqual(
      expect.objectContaining({
        name: "Pilot Build",
        price: 40_000,
        note: expect.stringContaining("Founder pilot credit"),
      }),
    );
  });
});

function validIntake(): ProposalIntake {
  return {
    project: tritenExample(),
    preparedFor: {
      companyName: "Triten Real Estate Partners",
      buyerName: "Triten Leadership Team",
      buyerTitle: "COO",
      website: "https://triten.com",
      logoText: "TRITEN",
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
        "The first phase should prove value through a reliable data foundation before expanding into workflow automation.",
      ],
      whatWeHeard: [
        "Teams spend recurring time pulling asset, inspection, and investor-reporting context across multiple systems.",
        "Leadership wants faster answers without creating another ungoverned reporting surface.",
      ],
      investmentSummary:
        "The recommended pilot is priced at $40K with a conservative payback under six months.",
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

function validDraft(): ProposalDraft {
  const intake = validIntake();
  return {
    project: intake.project,
    templateIds: ["generic/value-proposal"],
    metadata: {
      draftId: "draft-triten-2026-06-05",
      version: 1,
      status: "draft",
      createdAt: "2026-06-05T12:00:00Z",
      updatedAt: "2026-06-05T12:00:00Z",
      author: "Nolan Grout",
      source: "conversation",
      notes: ["Drafted from discovery conversation and ScopeForge analysis."],
    },
    preparedFor: intake.preparedFor,
    details: intake.details,
    valueProposal: {
      headline: "Turn scattered portfolio context into trusted operating answers.",
      narrative:
        "The pilot focuses first on reliable, high-value questions before broader agent automation.",
      unlocks: [
        "A governed Q&A layer for portfolio questions.",
        "Reduced reporting and lookup cycles across Monday.com and Power BI.",
      ],
      valueSources: [
        {
          label: "Investor-report assembly",
          source: "Discovery estimate",
          currentState: "Manual cross-system lookup before each reporting cycle.",
          futureState: "Reusable answers from governed pilot data.",
          annualValue: { low: 50_000, high: 90_000 },
          confidence: "medium",
        },
        {
          label: "Underwriting metric extraction",
          source: "ScopeForge value model",
          currentState: "Analysts re-create metric context from reports and boards.",
          futureState: "Priority metrics are retrievable through the Q&A layer.",
          annualValue: { low: 45_000, high: 75_000 },
          confidence: "high",
        },
      ],
      sixMonthSavings: { low: 50_000, high: 85_000 },
      annualValueTarget: 150_000,
    },
    buildPlan: [
      {
        name: "Source map and pilot question design",
        timing: "Week 1",
        description: "Confirm the highest-value questions, owners, and reconciliation points.",
        activities: ["Map Power BI and Monday.com sources.", "Prioritize pilot questions."],
        outcomes: ["Locked pilot backlog.", "Access and ownership checklist."],
      },
      {
        name: "Q&A build, QA, and handoff",
        timing: "Weeks 2–5",
        description: "Build and validate the MCP-backed Q&A layer with pilot users.",
        activities: ["Implement ingestion and Q&A workflows.", "Run acceptance testing."],
        outcomes: ["Working pilot experience.", "Handoff docs and Phase 2 backlog."],
      },
    ],
    actualDeliverables: [
      {
        title: "Governed portfolio Q&A pilot",
        description: "A bounded pilot experience over approved portfolio operating context.",
        included: [
          "MCP-backed Q&A workflow for priority operating questions.",
          "Prompt and response guardrails for pilot users.",
        ],
        acceptanceCriteria: [
          "Pilot users can answer approved questions from governed data.",
          "Outputs are reconciled against agreed source records before handoff.",
        ],
      },
    ],
    pricing: {
      summary: "Pilot investment is $40K after a founder pilot credit.",
      phases: [
        {
          name: "Pilot Build",
          price: 40_000,
          discounts: [
            {
              label: "Founder pilot credit",
              amount: 5_000,
              reason: "Applied to the first value-proposal pilot.",
            },
          ],
        },
        {
          name: "Phase 2 — AI Agent + Workflows",
          price: null,
          note: "Scoped after pilot evidence and usage data.",
        },
      ],
    },
    terms: {
      paymentTerms: "50% to start, 50% at pilot handoff.",
      startConditions: ["Approved scope and pilot investment."],
      assumptions: intake.assumptions,
      exclusions: intake.exclusions,
      clientResponsibilities: intake.clientInputs,
      changeControl: "Material scope changes are handled through a written change order.",
      expiration: "Valid for 30 days from proposal date.",
    },
    footer: {
      confidentiality:
        "Confidential and intended only for Triten Real Estate Partners and ScopeForge reviewers.",
      contact: "hello@nolango.com",
      legal: "Pricing excludes third-party software or data-platform fees unless listed in scope.",
    },
    nextSteps: intake.nextSteps,
  };
}
