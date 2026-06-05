import type { Analysis, Project, Range, Tier, Warning } from "../core/types.js";

export type ProposalAudience = "client" | "internal";

export interface PreparedFor {
  readonly companyName: string;
  readonly buyerName?: string;
  readonly buyerTitle?: string;
  readonly website?: string;
  readonly logoText?: string;
  readonly accentColor?: string;
}

export interface ProposalDetails {
  readonly title: string;
  readonly subtitle?: string;
  readonly date?: string;
  readonly recommendation: string;
  readonly executiveSummary: readonly string[];
  readonly whatWeHeard: readonly string[];
  readonly investmentSummary?: string;
  readonly timelineSummary?: string;
}

export interface ProposalScopeItem {
  readonly title: string;
  readonly description: string;
  readonly deliverables: readonly string[];
  readonly outcomes?: readonly string[];
}

export interface ProposalMilestone {
  readonly name: string;
  readonly timing: string;
  readonly outcomes: readonly string[];
}

export interface ProposalIntake {
  readonly project: Project;
  readonly preparedFor: PreparedFor;
  readonly details: ProposalDetails;
  readonly scope: readonly ProposalScopeItem[];
  readonly milestones: readonly ProposalMilestone[];
  readonly assumptions: readonly string[];
  readonly exclusions: readonly string[];
  readonly clientInputs: readonly string[];
  readonly nextSteps: readonly string[];
}

export type ProposalDraftTemplateId = "generic/value-proposal";

export type ProposalDraftStatus = "draft" | "review" | "ready" | "sent" | "accepted" | "archived";

export interface ProposalDraftMetadata {
  readonly draftId: string;
  readonly version: number;
  readonly status?: ProposalDraftStatus;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly author?: string;
  readonly source?: string;
  readonly notes?: readonly string[];
}

export type ProposalValueSourceConfidence = "low" | "medium" | "high";

export interface ProposalValueSourceRow {
  readonly label: string;
  readonly source: string;
  readonly currentState: string;
  readonly futureState: string;
  readonly annualValue: Range;
  readonly confidence?: ProposalValueSourceConfidence;
}

export interface ProposalDraftValueProposal {
  readonly headline: string;
  readonly narrative?: string;
  readonly unlocks: readonly string[];
  readonly valueSources: readonly ProposalValueSourceRow[];
  readonly sixMonthSavings: Range;
  readonly annualValueTarget: number;
}

export interface ProposalBuildPlanStep {
  readonly name: string;
  readonly timing: string;
  readonly description: string;
  readonly activities: readonly string[];
  readonly outcomes: readonly string[];
}

export interface ProposalActualDeliverable {
  readonly title: string;
  readonly description: string;
  readonly included: readonly string[];
  readonly acceptanceCriteria?: readonly string[];
}

export interface ProposalPhaseDiscount {
  readonly label: string;
  readonly amount: number;
  readonly reason?: string;
}

export interface ProposalPricingPhase {
  readonly name: string;
  readonly price: number | null;
  readonly discounts?: readonly ProposalPhaseDiscount[];
  readonly note?: string;
}

export interface ProposalDraftPricing {
  readonly summary: string;
  readonly phases: readonly ProposalPricingPhase[];
}

export interface ProposalTerms {
  readonly paymentTerms: string;
  readonly startConditions: readonly string[];
  readonly assumptions: readonly string[];
  readonly exclusions: readonly string[];
  readonly clientResponsibilities: readonly string[];
  readonly changeControl?: string;
  readonly expiration?: string;
}

export interface ProposalFooter {
  readonly confidentiality: string;
  readonly contact?: string;
  readonly legal?: string;
}

export interface ProposalDraft {
  readonly project: Project;
  readonly templateIds: readonly ProposalDraftTemplateId[];
  readonly metadata: ProposalDraftMetadata;
  readonly preparedFor: PreparedFor;
  readonly details: ProposalDetails;
  readonly valueProposal: ProposalDraftValueProposal;
  readonly buildPlan: readonly ProposalBuildPlanStep[];
  readonly actualDeliverables: readonly ProposalActualDeliverable[];
  readonly pricing: ProposalDraftPricing;
  readonly terms: ProposalTerms;
  readonly footer: ProposalFooter;
  readonly nextSteps: readonly string[];
}

export interface ProposalBrandColors {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
}

export interface ProposalBrand {
  readonly id: string;
  readonly name: string;
  readonly legalName?: string;
  readonly tagline?: string;
  readonly website?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly logoText: string;
  readonly colors: ProposalBrandColors;
}

export interface ProposalRenderOptions {
  readonly audience: ProposalAudience;
  readonly generatedAt?: Date;
  readonly seed?: number;
  readonly iterations?: number;
  readonly allowGuardrailErrors?: boolean;
}

export interface ProposalEconomicsView {
  readonly recommendedTier: Tier | null;
  readonly leadPrice: number | null;
  readonly formattedLeadPrice: string;
  readonly yearOneValueRange: string;
  readonly targetPriceRange: string;
  readonly paybackMonths: string;
  readonly futureUpsideRange: string;
}

export interface InternalProposalAppendix {
  readonly costFloorP50: string;
  readonly costFloorP90: string;
  readonly riskAdjustedFloorP90: string;
  readonly blendedRateRange: string;
  readonly margin: string;
  readonly warnings: readonly Warning[];
  readonly analysis: Analysis;
}

export interface ProposalViewModel {
  readonly audience: ProposalAudience;
  readonly generatedDate: string;
  readonly projectName: string;
  readonly preparedFor: PreparedFor;
  readonly brand: ProposalBrand;
  readonly details: ProposalDetails;
  readonly scope: readonly ProposalScopeItem[];
  readonly milestones: readonly ProposalMilestone[];
  readonly assumptions: readonly string[];
  readonly exclusions: readonly string[];
  readonly clientInputs: readonly string[];
  readonly nextSteps: readonly string[];
  readonly tiers: readonly Tier[];
  readonly economics: ProposalEconomicsView;
  readonly clientWarnings: readonly Warning[];
  readonly internalAppendix: InternalProposalAppendix | null;
}

export interface ProposalValidationError {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ProposalValidationError[] };
