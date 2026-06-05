import { describe, expect, it } from "vitest";
import { analyzeProject } from "../core/index.js";
import { tritenExample } from "../data/defaults.js";
import { BUILT_IN_BRANDS } from "./brands.js";
import {
  buildProposalViewModel,
  getClientBlockingWarnings,
  hasClientBlockingWarnings,
} from "./model.js";
import type { ProposalIntake } from "./types.js";

describe("buildProposalViewModel", () => {
  it("identifies the first priced tier as the recommended offer", () => {
    const intake = validIntake({
      pricingTiers: [
        { name: "Phase 2", price: null, note: "Scoped after pilot" },
        { name: "Pilot Build", price: 40_000 },
      ],
    });
    const viewModel = buildProposalViewModel(
      intake,
      BUILT_IN_BRANDS.nolan,
      analyzeProject(intake.project),
      {
        audience: "client",
      },
    );

    expect(viewModel.economics.recommendedTier?.name).toBe("Pilot Build");
    expect(viewModel.economics.formattedLeadPrice).toBe("$40,000");
    expect(viewModel.internalAppendix).toBeNull();
  });

  it("includes internal appendix fields only for internal output", () => {
    const intake = validIntake();
    const viewModel = buildProposalViewModel(
      intake,
      BUILT_IN_BRANDS.partners,
      analyzeProject(intake.project),
      {
        audience: "internal",
        generatedAt: new Date("2026-06-05T12:00:00Z"),
      },
    );

    expect(viewModel.internalAppendix).not.toBeNull();
    expect(viewModel.internalAppendix?.costFloorP50).toMatch(/^\$/);
    expect(viewModel.internalAppendix?.riskAdjustedFloorP90).toMatch(/^\$/);
  });

  it("flags guardrail errors that block client output by default", () => {
    const intake = validIntake({ pricingTiers: [{ name: "Lowball Pilot", price: 5_000 }] });
    const analysis = analyzeProject(intake.project);

    expect(hasClientBlockingWarnings(analysis, { audience: "client" })).toBe(true);
    expect(getClientBlockingWarnings(analysis, { audience: "client" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "below-floor", severity: "error" })]),
    );
    expect(getClientBlockingWarnings(analysis, { audience: "internal" })).toHaveLength(0);
  });
});

interface ValidIntakeOptions {
  readonly pricingTiers?: ProposalIntake["project"]["pricing"]["tiers"];
}

function validIntake(options: ValidIntakeOptions = {}): ProposalIntake {
  const project = tritenExample();
  return {
    project: {
      ...project,
      pricing: {
        ...project.pricing,
        tiers: options.pricingTiers ?? project.pricing.tiers,
      },
    },
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
        "A focused pilot can turn scattered operating context into trusted answers for the leadership team.",
      ],
      whatWeHeard: ["Teams spend recurring time pulling context across multiple systems."],
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
