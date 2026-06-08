import { analyzeProject } from "../../core/index.js";
import { leadPrice } from "../../core/pricing.js";
import { getClientBlockingWarnings } from "../../proposal/model.js";
import { formatMoney, formatMoneyRange, formatMonths } from "../../proposal/format.js";
import { proposalDraftToIntake, validateProposalDraft } from "../../proposal/schema.js";
import type { ProposalAudience, ProposalDraft } from "../../proposal/types.js";
import type { ProposalProjectStateResponse } from "./api.js";
import type {
  DraftSnapshot,
  EconomicsSnapshot,
  SessionSnapshot,
  ValidationSnapshot,
} from "./types.js";

export function projectStateToSessionSnapshot(
  state: ProposalProjectStateResponse,
  audience: ProposalAudience = "client",
): SessionSnapshot {
  const draft = state.sourceOfTruth.draft;
  return {
    sessionId: `project:${state.project.projectId}:${state.currentVersion.versionId}`,
    author: state.currentVersion.createdBy,
    projectId: state.project.projectId,
    projectVersionId: state.currentVersion.versionId,
    draft: buildDraftSnapshot(draft, state.sourceOfTruth.vendorBrand.id, audience),
    economics: buildEconomicsSnapshot(draft),
    validation: buildValidationSnapshot(draft, audience),
    fullDraft: draft,
  } satisfies SessionSnapshot;
}

function buildDraftSnapshot(
  draft: ProposalDraft,
  brandId: string,
  audience: ProposalAudience,
): DraftSnapshot {
  return {
    draftId: draft.metadata.draftId,
    status: draft.metadata.status ?? "draft",
    templateId: draft.templateIds[0] ?? "generic/value-proposal",
    companyName: draft.preparedFor.companyName,
    ...(draft.preparedFor.buyerName === undefined
      ? {}
      : { buyerName: draft.preparedFor.buyerName }),
    title: draft.details.title,
    recommendation: draft.details.recommendation,
    executiveSummary: draft.details.executiveSummary,
    valueHeadline: draft.valueProposal.headline,
    annualValueTarget: draft.valueProposal.annualValueTarget,
    pricingSummary: draft.pricing.summary,
    phases: draft.pricing.phases.map((phase) => ({ name: phase.name, price: phase.price })),
    nextSteps: draft.nextSteps,
    audience,
    brandId,
  } satisfies DraftSnapshot;
}

function buildEconomicsSnapshot(draft: ProposalDraft): EconomicsSnapshot | null {
  if (draft.project.cost.workstreams.length === 0) return null;
  const intake = proposalDraftToIntake(draft);
  const analysis = analyzeProject(intake.project);
  const price = leadPrice(intake.project.pricing.tiers);
  return {
    leadPrice: price,
    formattedLeadPrice: price === null ? "Scoped after pilot" : formatMoney(price),
    yearOneValueRange: formatMoneyRange(analysis.value.yearOne),
    targetPriceRange: formatMoneyRange(analysis.pricing.targetBand),
    paybackMonths: formatMonths(analysis.pricing.paybackMonths),
    futureUpsideRange: formatMoneyRange(analysis.value.futureUpside),
  } satisfies EconomicsSnapshot;
}

function buildValidationSnapshot(
  draft: ProposalDraft,
  audience: ProposalAudience,
): ValidationSnapshot {
  const result = validateProposalDraft(draft);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map((error) => ({ path: error.path, message: error.message })),
      guardrails: [],
      blocking: [],
    } satisfies ValidationSnapshot;
  }

  const intake = proposalDraftToIntake(result.value);
  const analysis = analyzeProject(intake.project);
  const blocking = getClientBlockingWarnings(analysis, { audience });
  return {
    ok: true,
    errors: [],
    guardrails: analysis.warnings.map((warning) => ({
      rule: warning.rule,
      severity: warning.severity,
      message: warning.message,
    })),
    blocking: blocking.map((warning) => `${warning.rule}: ${warning.message}`),
  } satisfies ValidationSnapshot;
}
