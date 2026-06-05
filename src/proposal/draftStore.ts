import type { Range, RoleSegment } from "../core/types.js";
import type {
  ProposalActualDeliverable,
  ProposalBuildPlanStep,
  ProposalDraft,
  ProposalDraftStatus,
  ProposalDraftTemplateId,
  ProposalIntake,
  ProposalPhaseDiscount,
  ProposalPricingPhase,
  ProposalValueSourceConfidence,
  ProposalValueSourceRow,
} from "./types.js";

export interface ProposalDraftVersion {
  readonly version: number;
  readonly draft: ProposalDraft;
  readonly label?: string;
  readonly createdAt?: string;
}

export interface ProposalDraftStoreState {
  readonly current: ProposalDraft;
  readonly history: readonly ProposalDraftVersion[];
  readonly currentVersion: number;
  readonly nextVersion: number;
}

export interface ProposalDraftStoreOptions {
  readonly label?: string;
  readonly createdAt?: string;
}

export interface ProposalDraftCommitOptions {
  readonly label?: string;
  readonly updatedAt?: string;
  readonly author?: string;
  readonly source?: string;
  readonly notes?: readonly string[];
}

export interface ProposalDraftFromIntakeOptions {
  readonly draftId?: string;
  readonly templateId?: ProposalDraftTemplateId;
  readonly status?: ProposalDraftStatus;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly author?: string;
  readonly source?: string;
  readonly notes?: readonly string[];
  readonly footerContact?: string;
  readonly footerLegal?: string;
  readonly paymentTerms?: string;
  readonly changeControl?: string;
  readonly expiration?: string;
}

export interface PreparedForPatch {
  readonly companyName?: string;
  readonly buyerName?: string;
  readonly buyerTitle?: string;
  readonly website?: string;
  readonly logoText?: string;
  readonly accentColor?: string;
}

export interface ProposalDetailsPatch {
  readonly title?: string;
  readonly subtitle?: string;
  readonly date?: string;
  readonly recommendation?: string;
  readonly executiveSummary?: readonly string[];
  readonly whatWeHeard?: readonly string[];
  readonly investmentSummary?: string;
  readonly timelineSummary?: string;
}

export interface ProposalDraftValueProposalPatch {
  readonly headline?: string;
  readonly narrative?: string;
  readonly unlocks?: readonly string[];
  readonly valueSources?: readonly ProposalValueSourceRow[];
  readonly sixMonthSavings?: Range;
  readonly annualValueTarget?: number;
}

export interface ProposalValueSourceRowPatch {
  readonly label?: string;
  readonly source?: string;
  readonly currentState?: string;
  readonly futureState?: string;
  readonly annualValue?: Range;
  readonly confidence?: ProposalValueSourceConfidence;
}

export interface ProposalBuildPlanStepPatch {
  readonly name?: string;
  readonly timing?: string;
  readonly description?: string;
  readonly activities?: readonly string[];
  readonly outcomes?: readonly string[];
}

export interface ProposalActualDeliverablePatch {
  readonly title?: string;
  readonly description?: string;
  readonly included?: readonly string[];
  readonly acceptanceCriteria?: readonly string[];
}

export interface ProposalDraftPricingPatch {
  readonly summary?: string;
  readonly phases?: readonly ProposalPricingPhase[];
}

export interface ProposalPricingPhasePatch {
  readonly name?: string;
  readonly price?: number | null;
  readonly discounts?: readonly ProposalPhaseDiscount[];
  readonly note?: string;
}

export interface ProposalTermsPatch {
  readonly paymentTerms?: string;
  readonly startConditions?: readonly string[];
  readonly assumptions?: readonly string[];
  readonly exclusions?: readonly string[];
  readonly clientResponsibilities?: readonly string[];
  readonly changeControl?: string;
  readonly expiration?: string;
}

export interface ProposalFooterPatch {
  readonly confidentiality?: string;
  readonly contact?: string;
  readonly legal?: string;
}

export type ProposalDraftUpdater = (draft: ProposalDraft) => ProposalDraft;

export function proposalIntakeToDraft(
  intake: ProposalIntake,
  options: ProposalDraftFromIntakeOptions = {},
): ProposalDraft {
  const valueRange = estimateYearOneValue(intake);
  const templateId = options.templateId ?? "generic/value-proposal";

  return {
    project: intake.project,
    templateIds: [templateId],
    metadata: buildDraftMetadata(intake, options),
    preparedFor: intake.preparedFor,
    details: intake.details,
    valueProposal: {
      headline: intake.details.recommendation,
      narrative: intake.details.executiveSummary.join(" "),
      unlocks: deriveUnlocks(intake),
      valueSources: deriveValueSourceRows(intake),
      sixMonthSavings: halveRange(valueRange),
      annualValueTarget: positiveAnnualValueTarget(valueRange),
    },
    buildPlan: intake.milestones.map(intakeMilestoneToBuildPlanStep),
    actualDeliverables: intake.scope.map(intakeScopeItemToActualDeliverable),
    pricing: {
      summary: intake.details.investmentSummary ?? derivePricingSummary(intake),
      phases: intake.project.pricing.tiers.map((tier) => ({
        name: tier.name,
        price: tier.price,
        ...(tier.note === undefined ? {} : { note: tier.note }),
      })),
    },
    terms: {
      paymentTerms: options.paymentTerms ?? "Payment terms to be confirmed in the final agreement.",
      startConditions: intake.nextSteps,
      assumptions: intake.assumptions,
      exclusions: intake.exclusions,
      clientResponsibilities: intake.clientInputs,
      ...(options.changeControl === undefined ? {} : { changeControl: options.changeControl }),
      ...(options.expiration === undefined ? {} : { expiration: options.expiration }),
    },
    footer: {
      confidentiality: `Confidential proposal prepared for ${intake.preparedFor.companyName}.`,
      ...(options.footerContact === undefined ? {} : { contact: options.footerContact }),
      ...(options.footerLegal === undefined ? {} : { legal: options.footerLegal }),
    },
    nextSteps: intake.nextSteps,
  };
}

export function createProposalDraftStore(
  draft: ProposalDraft,
  options: ProposalDraftStoreOptions = {},
): ProposalDraftStoreState {
  const current = normalizeDraftVersion(draft, Math.max(1, draft.metadata.version));
  const createdAt = options.createdAt ?? current.metadata.updatedAt ?? current.metadata.createdAt;
  const snapshot = createDraftVersion(current, {
    label: options.label ?? "Initial draft",
    ...(createdAt === undefined ? {} : { createdAt }),
  });

  return {
    current,
    history: [snapshot],
    currentVersion: current.metadata.version,
    nextVersion: current.metadata.version + 1,
  };
}

export function createProposalDraftStoreFromIntake(
  intake: ProposalIntake,
  options: ProposalDraftFromIntakeOptions = {},
): ProposalDraftStoreState {
  const draft = proposalIntakeToDraft(intake, options);
  return createProposalDraftStore(draft, {
    label: "Converted from ProposalIntake",
    ...(draft.metadata.createdAt === undefined ? {} : { createdAt: draft.metadata.createdAt }),
  });
}

export function updateProposalDraft(
  state: ProposalDraftStoreState,
  updater: ProposalDraftUpdater,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  const nextDraft = updater(state.current);
  if (nextDraft === state.current) return state;
  return replaceCurrentDraft(state, nextDraft, options);
}

export function replaceCurrentDraft(
  state: ProposalDraftStoreState,
  draft: ProposalDraft,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  const version = nextVersionNumber(state);
  const current = withCommittedMetadata(draft, version, options);
  const historyBeforeCurrent = reachableHistory(state);
  const createdAt = options.updatedAt ?? current.metadata.updatedAt ?? current.metadata.createdAt;
  const snapshot = createDraftVersion(current, {
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(createdAt === undefined ? {} : { createdAt }),
  });

  return {
    current,
    history: [...historyBeforeCurrent, snapshot],
    currentVersion: version,
    nextVersion: version + 1,
  };
}

export function updateDraftPreparedFor(
  state: ProposalDraftStoreState,
  patch: PreparedForPatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  return updateProposalDraft(
    state,
    (draft) => ({ ...draft, preparedFor: { ...draft.preparedFor, ...patch } }),
    options,
  );
}

export function updateDraftDetails(
  state: ProposalDraftStoreState,
  patch: ProposalDetailsPatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  return updateProposalDraft(
    state,
    (draft) => ({ ...draft, details: { ...draft.details, ...patch } }),
    options,
  );
}

export function updateDraftValueProposal(
  state: ProposalDraftStoreState,
  patch: ProposalDraftValueProposalPatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  return updateProposalDraft(
    state,
    (draft) => ({ ...draft, valueProposal: { ...draft.valueProposal, ...patch } }),
    options,
  );
}

export function updateDraftValueSource(
  state: ProposalDraftStoreState,
  index: number,
  patch: ProposalValueSourceRowPatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  if (!hasIndex(state.current.valueProposal.valueSources, index)) return state;

  return updateProposalDraft(
    state,
    (draft) => ({
      ...draft,
      valueProposal: {
        ...draft.valueProposal,
        valueSources: draft.valueProposal.valueSources.map((row, rowIndex) =>
          rowIndex === index ? { ...row, ...patch } : row,
        ),
      },
    }),
    options,
  );
}

export function updateDraftBuildPlanStep(
  state: ProposalDraftStoreState,
  index: number,
  patch: ProposalBuildPlanStepPatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  if (!hasIndex(state.current.buildPlan, index)) return state;

  return updateProposalDraft(
    state,
    (draft) => ({
      ...draft,
      buildPlan: draft.buildPlan.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step,
      ),
    }),
    options,
  );
}

export function updateDraftActualDeliverable(
  state: ProposalDraftStoreState,
  index: number,
  patch: ProposalActualDeliverablePatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  if (!hasIndex(state.current.actualDeliverables, index)) return state;

  return updateProposalDraft(
    state,
    (draft) => ({
      ...draft,
      actualDeliverables: draft.actualDeliverables.map((deliverable, deliverableIndex) =>
        deliverableIndex === index ? { ...deliverable, ...patch } : deliverable,
      ),
    }),
    options,
  );
}

export function updateDraftPricing(
  state: ProposalDraftStoreState,
  patch: ProposalDraftPricingPatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  return updateProposalDraft(
    state,
    (draft) => ({ ...draft, pricing: { ...draft.pricing, ...patch } }),
    options,
  );
}

export function updateDraftPricingPhase(
  state: ProposalDraftStoreState,
  index: number,
  patch: ProposalPricingPhasePatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  if (!hasIndex(state.current.pricing.phases, index)) return state;

  return updateProposalDraft(
    state,
    (draft) => ({
      ...draft,
      pricing: {
        ...draft.pricing,
        phases: draft.pricing.phases.map((phase, phaseIndex) =>
          phaseIndex === index ? { ...phase, ...patch } : phase,
        ),
      },
    }),
    options,
  );
}

export function updateDraftTerms(
  state: ProposalDraftStoreState,
  patch: ProposalTermsPatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  return updateProposalDraft(
    state,
    (draft) => ({ ...draft, terms: { ...draft.terms, ...patch } }),
    options,
  );
}

export function updateDraftFooter(
  state: ProposalDraftStoreState,
  patch: ProposalFooterPatch,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  return updateProposalDraft(
    state,
    (draft) => ({ ...draft, footer: { ...draft.footer, ...patch } }),
    options,
  );
}

export function replaceDraftNextSteps(
  state: ProposalDraftStoreState,
  nextSteps: readonly string[],
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  return updateProposalDraft(state, (draft) => ({ ...draft, nextSteps }), options);
}

export function updateDraftStatus(
  state: ProposalDraftStoreState,
  status: ProposalDraftStatus,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  return updateProposalDraft(
    state,
    (draft) => ({ ...draft, metadata: { ...draft.metadata, status } }),
    options,
  );
}

export function switchDraftTemplate(
  state: ProposalDraftStoreState,
  templateId: ProposalDraftTemplateId,
  options: ProposalDraftCommitOptions = {},
): ProposalDraftStoreState {
  if (state.current.templateIds.length === 1 && state.current.templateIds[0] === templateId) {
    return state;
  }

  return updateProposalDraft(state, (draft) => ({ ...draft, templateIds: [templateId] }), options);
}

export function canUndoDraft(state: ProposalDraftStoreState): boolean {
  return currentHistoryIndex(state) > 0;
}

export function canRedoDraft(state: ProposalDraftStoreState): boolean {
  const currentIndex = currentHistoryIndex(state);
  return currentIndex >= 0 && currentIndex < state.history.length - 1;
}

export function undoDraft(state: ProposalDraftStoreState): ProposalDraftStoreState {
  const currentIndex = currentHistoryIndex(state);
  if (currentIndex <= 0) return state;

  const previous = state.history[currentIndex - 1];
  if (previous === undefined) return state;

  return {
    ...state,
    current: previous.draft,
    currentVersion: previous.version,
  };
}

export function redoDraft(state: ProposalDraftStoreState): ProposalDraftStoreState {
  const currentIndex = currentHistoryIndex(state);
  if (currentIndex < 0 || currentIndex >= state.history.length - 1) return state;

  const next = state.history[currentIndex + 1];
  if (next === undefined) return state;

  return {
    ...state,
    current: next.draft,
    currentVersion: next.version,
  };
}

export function getDraftVersion(
  state: ProposalDraftStoreState,
  version: number,
): ProposalDraftVersion | null {
  for (const snapshot of state.history) {
    if (snapshot.version === version) return snapshot;
  }
  return null;
}

function buildDraftMetadata(
  intake: ProposalIntake,
  options: ProposalDraftFromIntakeOptions,
): ProposalDraft["metadata"] {
  return {
    draftId: options.draftId ?? defaultDraftId(intake),
    version: 1,
    status: options.status ?? "draft",
    source: options.source ?? "proposal-intake",
    notes: options.notes ?? ["Converted from ProposalIntake."],
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
    ...(options.updatedAt === undefined ? {} : { updatedAt: options.updatedAt }),
    ...(options.author === undefined ? {} : { author: options.author }),
  };
}

function intakeMilestoneToBuildPlanStep(
  milestone: ProposalIntake["milestones"][number],
): ProposalBuildPlanStep {
  return {
    name: milestone.name,
    timing: milestone.timing,
    description: firstString(
      milestone.outcomes,
      `Complete ${milestone.name} and confirm the next delivery decision.`,
    ),
    activities: [`Complete ${milestone.name}.`, "Confirm risks, owners, and acceptance evidence."],
    outcomes: milestone.outcomes,
  };
}

function intakeScopeItemToActualDeliverable(
  item: ProposalIntake["scope"][number],
): ProposalActualDeliverable {
  return {
    title: item.title,
    description: item.description,
    included: item.deliverables,
    ...(item.outcomes === undefined || item.outcomes.length === 0
      ? {}
      : { acceptanceCriteria: item.outcomes }),
  };
}

function deriveUnlocks(intake: ProposalIntake): readonly string[] {
  const scopeOutcomes = intake.scope.flatMap((item) => item.outcomes ?? []);
  if (scopeOutcomes.length > 0) return scopeOutcomes;
  if (intake.details.executiveSummary.length > 0) return intake.details.executiveSummary;
  return [intake.details.recommendation];
}

function deriveValueSourceRows(intake: ProposalIntake): readonly ProposalValueSourceRow[] {
  const workflowRows: readonly ProposalValueSourceRow[] = intake.project.value.workflows.map(
    (workflow) => ({
      label: workflow.name,
      source: "ProposalIntake.project.value.workflows",
      currentState: `${workflow.name} carries recurring manual effort or cycle cost today.`,
      futureState: "The proposed build reduces that recurring effort through a governed workflow.",
      annualValue: { low: workflow.low, high: workflow.high },
      confidence: "medium",
    }),
  );

  const segmentRows = intake.project.value.segments.map((segment) =>
    roleSegmentToValueSourceRow(
      segment,
      intake.project.client.workingWeeks,
      intake.project.value.realizationFactor,
    ),
  );

  const rows = [...workflowRows, ...segmentRows];
  if (rows.length > 0) return rows;

  return [
    {
      label: "Value model",
      source: "ProposalIntake.project.value",
      currentState: "Current process value is still being quantified.",
      futureState: "The proposal will refine the measurable value model during discovery.",
      annualValue: { low: 1, high: 1 },
      confidence: "low",
    },
  ];
}

function roleSegmentToValueSourceRow(
  segment: RoleSegment,
  workingWeeks: number,
  realizationFactor: Range,
): ProposalValueSourceRow {
  return {
    label: `${segment.role} time recovery`,
    source: "ProposalIntake.project.value.segments",
    currentState: `${segment.role} spends ${formatHours(segment.hoursPerWeek)} hours per week across ${formatNumber(segment.headcount)} people.`,
    futureState:
      "Recovered time is redirected to higher-value work instead of manual coordination.",
    annualValue: estimateRoleSegmentValue(segment, workingWeeks, realizationFactor),
    confidence: "medium",
  };
}

function estimateYearOneValue(intake: ProposalIntake): Range {
  const timeRanges = intake.project.value.segments.map((segment) =>
    estimateRoleSegmentValue(
      segment,
      intake.project.client.workingWeeks,
      intake.project.value.realizationFactor,
    ),
  );
  const workflowRanges = intake.project.value.workflows.map((workflow) => ({
    low: workflow.low,
    high: workflow.high,
  }));

  return sumRanges([...timeRanges, ...workflowRanges]);
}

function estimateRoleSegmentValue(
  segment: RoleSegment,
  workingWeeks: number,
  realizationFactor: Range,
): Range {
  const theoretical = segment.headcount * segment.hoursPerWeek * workingWeeks * segment.loadedRate;
  return {
    low: theoretical * realizationFactor.low,
    high: theoretical * realizationFactor.high,
  };
}

function sumRanges(ranges: readonly Range[]): Range {
  let low = 0;
  let high = 0;
  for (const range of ranges) {
    low += range.low;
    high += range.high;
  }
  return { low, high };
}

function halveRange(range: Range): Range {
  return {
    low: range.low / 2,
    high: range.high / 2,
  };
}

function positiveAnnualValueTarget(range: Range): number {
  const midpoint = (range.low + range.high) / 2;
  return midpoint > 0 ? midpoint : 1;
}

function derivePricingSummary(intake: ProposalIntake): string {
  const firstPricedTier = intake.project.pricing.tiers.find((tier) => tier.price !== null);
  if (firstPricedTier !== undefined) {
    return `Recommended investment starts with ${firstPricedTier.name}.`;
  }
  return "Investment is confirmed after the proposal scope is approved.";
}

function withCommittedMetadata(
  draft: ProposalDraft,
  version: number,
  options: ProposalDraftCommitOptions,
): ProposalDraft {
  return {
    ...draft,
    metadata: {
      ...draft.metadata,
      version,
      ...(options.updatedAt === undefined ? {} : { updatedAt: options.updatedAt }),
      ...(options.author === undefined ? {} : { author: options.author }),
      ...(options.source === undefined ? {} : { source: options.source }),
      ...(options.notes === undefined ? {} : { notes: options.notes }),
    },
  };
}

function normalizeDraftVersion(draft: ProposalDraft, version: number): ProposalDraft {
  if (draft.metadata.version === version) return draft;
  return {
    ...draft,
    metadata: {
      ...draft.metadata,
      version,
    },
  };
}

function createDraftVersion(
  draft: ProposalDraft,
  options: ProposalDraftStoreOptions = {},
): ProposalDraftVersion {
  return {
    version: draft.metadata.version,
    draft,
    ...(options.label === undefined ? {} : { label: options.label }),
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  };
}

function reachableHistory(state: ProposalDraftStoreState): readonly ProposalDraftVersion[] {
  const currentIndex = currentHistoryIndex(state);
  if (currentIndex < 0) {
    return [createDraftVersion(state.current, { label: "Recovered current draft" })];
  }
  return state.history.slice(0, currentIndex + 1);
}

function currentHistoryIndex(state: ProposalDraftStoreState): number {
  return state.history.findIndex((snapshot) => snapshot.version === state.currentVersion);
}

function nextVersionNumber(state: ProposalDraftStoreState): number {
  const highestHistoryVersion = state.history.reduce(
    (highest, snapshot) => Math.max(highest, snapshot.version),
    state.current.metadata.version,
  );
  return Math.max(state.nextVersion, highestHistoryVersion + 1, 1);
}

function hasIndex(items: readonly unknown[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < items.length;
}

function firstString(values: readonly string[], fallback: string): string {
  for (const value of values) {
    if (value.trim().length > 0) return value;
  }
  return fallback;
}

function defaultDraftId(intake: ProposalIntake): string {
  const slug = ["draft", intake.preparedFor.companyName, intake.details.title]
    .map(slugify)
    .filter((part) => part.length > 0)
    .join("-");
  return slug.length > 0 ? slug : "proposal-draft";
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatHours(input: number): string {
  if (Number.isInteger(input)) return input.toLocaleString("en-US");
  return input.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatNumber(input: number): string {
  return input.toLocaleString("en-US");
}
