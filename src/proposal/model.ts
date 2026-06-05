import type { Analysis, Tier, Warning } from "../core/types.js";
import { leadPrice } from "../core/pricing.js";
import type {
  InternalProposalAppendix,
  ProposalBrand,
  ProposalIntake,
  ProposalRenderOptions,
  ProposalViewModel,
} from "./types.js";
import {
  formatMoney,
  formatMoneyRange,
  formatMonths,
  formatPercent,
  formatProposalDate,
  formatTriEstimateRange,
} from "./format.js";

export function buildProposalViewModel(
  intake: ProposalIntake,
  brand: ProposalBrand,
  analysis: Analysis,
  options: ProposalRenderOptions,
): ProposalViewModel {
  const recommendedTier = firstPricedTier(intake.project.pricing.tiers);
  const recommendedPrice = leadPrice(intake.project.pricing.tiers);

  return {
    audience: options.audience,
    generatedDate: resolveGeneratedDate(intake.details.date, options.generatedAt),
    projectName: intake.project.project,
    preparedFor: intake.preparedFor,
    brand,
    details: intake.details,
    scope: intake.scope,
    milestones: intake.milestones,
    assumptions: intake.assumptions,
    exclusions: intake.exclusions,
    clientInputs: intake.clientInputs,
    nextSteps: intake.nextSteps,
    tiers: intake.project.pricing.tiers,
    economics: {
      recommendedTier,
      leadPrice: recommendedPrice,
      formattedLeadPrice:
        recommendedPrice === null ? "Scoped after pilot" : formatMoney(recommendedPrice),
      yearOneValueRange: formatMoneyRange(analysis.value.yearOne),
      targetPriceRange: formatMoneyRange(analysis.pricing.targetBand),
      paybackMonths: formatMonths(analysis.pricing.paybackMonths),
      futureUpsideRange: formatMoneyRange(analysis.value.futureUpside),
    },
    clientWarnings: analysis.warnings.filter((warning) => warning.severity === "warning"),
    internalAppendix:
      options.audience === "internal" ? buildInternalAppendix(intake, analysis) : null,
  };
}

export function getClientBlockingWarnings(
  analysis: Analysis,
  options: Pick<ProposalRenderOptions, "audience">,
): readonly Warning[] {
  if (options.audience !== "client") return [];
  return analysis.warnings.filter((warning) => warning.severity === "error");
}

export function hasClientBlockingWarnings(
  analysis: Analysis,
  options: Pick<ProposalRenderOptions, "audience">,
): boolean {
  return getClientBlockingWarnings(analysis, options).length > 0;
}

function buildInternalAppendix(
  intake: ProposalIntake,
  analysis: Analysis,
): InternalProposalAppendix {
  return {
    costFloorP50: formatMoney(analysis.cost.priceFloor.p50),
    costFloorP90: formatMoney(analysis.cost.priceFloor.p90),
    riskAdjustedFloorP90: formatMoney(analysis.cost.riskAdjustedFloorP90),
    blendedRateRange: formatTriEstimateRange(intake.project.cost.blendedRate, "$/hr"),
    margin: formatPercent(intake.project.cost.margin),
    warnings: analysis.warnings,
    analysis,
  };
}

function firstPricedTier(tiers: readonly Tier[]): Tier | null {
  for (const tier of tiers) {
    if (tier.price !== null) return tier;
  }
  return null;
}

function resolveGeneratedDate(
  intakeDate: string | undefined,
  generatedAt: Date | undefined,
): string {
  if (intakeDate !== undefined) return intakeDate;
  if (generatedAt !== undefined) return formatProposalDate(generatedAt);
  return "Prepared date TBD";
}
