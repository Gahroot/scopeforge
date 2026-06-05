import type { Project, Range, Tier } from "../core/types.js";
import { validateProject } from "../data/schema.js";
import type {
  PreparedFor,
  ProposalActualDeliverable,
  ProposalBuildPlanStep,
  ProposalDetails,
  ProposalDraft,
  ProposalDraftMetadata,
  ProposalDraftPricing,
  ProposalDraftStatus,
  ProposalDraftTemplateId,
  ProposalDraftValueProposal,
  ProposalFooter,
  ProposalIntake,
  ProposalMilestone,
  ProposalPhaseDiscount,
  ProposalPricingPhase,
  ProposalScopeItem,
  ProposalTerms,
  ProposalValidationError,
  ProposalValueSourceConfidence,
  ProposalValueSourceRow,
  ValidationResult,
} from "./types.js";

export const PROPOSAL_DRAFT_TEMPLATE_IDS = [
  "generic/value-proposal",
] as const satisfies readonly ProposalDraftTemplateId[];

const PROPOSAL_DRAFT_STATUSES = [
  "draft",
  "review",
  "ready",
  "sent",
  "accepted",
  "archived",
] as const satisfies readonly ProposalDraftStatus[];

const VALUE_SOURCE_CONFIDENCES = [
  "low",
  "medium",
  "high",
] as const satisfies readonly ProposalValueSourceConfidence[];

type MutableProposalValidationErrorList = ProposalValidationError[];

export function validateProposalIntake(input: unknown): ValidationResult<ProposalIntake> {
  const errors: MutableProposalValidationErrorList = [];

  if (!isRecord(input)) {
    return validationFailure([{ path: "$", message: "Proposal intake must be an object." }]);
  }

  const project = validateEmbeddedProject(input.project, errors);
  validatePreparedFor(input.preparedFor, "preparedFor", errors);
  validateProposalDetails(input.details, "details", errors);
  validateRequiredStringArray(input.assumptions, "assumptions", errors);
  validateRequiredStringArray(input.exclusions, "exclusions", errors);
  validateRequiredStringArray(input.clientInputs, "clientInputs", errors);
  validateRequiredStringArray(input.nextSteps, "nextSteps", errors);
  validateArray(input.scope, "scope", errors, { minLength: 1 }, (item, itemPath) => {
    validateProposalScopeItem(item, itemPath, errors);
  });
  validateArray(input.milestones, "milestones", errors, { minLength: 1 }, (item, itemPath) => {
    validateProposalMilestone(item, itemPath, errors);
  });

  if (project !== null) validateProposalReadiness(project, errors);

  if (errors.length > 0) return validationFailure(errors);
  return { ok: true, value: input as unknown as ProposalIntake };
}

export function validateProposalDraft(input: unknown): ValidationResult<ProposalDraft> {
  const errors: MutableProposalValidationErrorList = [];

  if (!isRecord(input)) {
    return validationFailure([{ path: "$", message: "Proposal draft must be an object." }]);
  }

  const project = validateEmbeddedProject(input.project, errors);
  validateProposalDraftTemplateIds(input.templateIds, "templateIds", errors);
  validateProposalDraftMetadata(input.metadata, "metadata", errors);
  validatePreparedFor(input.preparedFor, "preparedFor", errors);
  validateProposalDetails(input.details, "details", errors);
  validateProposalDraftValueProposal(input.valueProposal, "valueProposal", errors);
  validateArray(input.buildPlan, "buildPlan", errors, { minLength: 1 }, (item, itemPath) => {
    validateProposalBuildPlanStep(item, itemPath, errors);
  });
  validateArray(
    input.actualDeliverables,
    "actualDeliverables",
    errors,
    { minLength: 1 },
    (item, itemPath) => {
      validateProposalActualDeliverable(item, itemPath, errors);
    },
  );
  validateProposalDraftPricing(input.pricing, "pricing", errors);
  validateProposalTerms(input.terms, "terms", errors);
  validateProposalFooter(input.footer, "footer", errors);
  validateRequiredStringArray(input.nextSteps, "nextSteps", errors);

  if (project !== null) validateProjectScopeAndValueReadiness(project, errors);

  if (errors.length > 0) return validationFailure(errors);
  return { ok: true, value: input as unknown as ProposalDraft };
}

export function proposalDraftToIntake(draft: ProposalDraft): ProposalIntake {
  const project = {
    ...draft.project,
    pricing: {
      ...draft.project.pricing,
      tiers: draft.pricing.phases.map(pricingPhaseToTier),
    },
  } satisfies Project;

  const details = {
    ...draft.details,
    investmentSummary: draft.details.investmentSummary ?? draft.pricing.summary,
    timelineSummary: draft.details.timelineSummary ?? buildPlanTimelineSummary(draft.buildPlan),
  } satisfies ProposalDetails;

  return {
    project,
    preparedFor: draft.preparedFor,
    details,
    scope: draft.actualDeliverables.map(actualDeliverableToScopeItem),
    milestones: draft.buildPlan.map(buildPlanStepToMilestone),
    assumptions: draft.terms.assumptions,
    exclusions: draft.terms.exclusions,
    clientInputs: draft.terms.clientResponsibilities,
    nextSteps: draft.nextSteps,
  };
}

function validateEmbeddedProject(
  input: unknown,
  errors: MutableProposalValidationErrorList,
): Project | null {
  const result = validateProject(input);
  if (result.ok) return result.value;

  for (const error of result.errors) {
    const childPath = error.path === "$" ? "project" : `project.${error.path}`;
    addError(errors, childPath, error.message);
  }
  return null;
}

function validateProposalReadiness(
  project: Project,
  errors: MutableProposalValidationErrorList,
): void {
  validateProjectScopeAndValueReadiness(project, errors);

  if (!project.pricing.tiers.some((tier) => tier.price !== null)) {
    addError(
      errors,
      "project.pricing.tiers",
      "Add at least one priced tier before generating a proposal.",
    );
  }
}

function validateProjectScopeAndValueReadiness(
  project: Project,
  errors: MutableProposalValidationErrorList,
): void {
  if (project.cost.workstreams.length === 0) {
    addError(
      errors,
      "project.cost.workstreams",
      "Add at least one scoped workstream before generating a proposal.",
    );
  }

  if (project.value.segments.length === 0 && project.value.workflows.length === 0) {
    addError(
      errors,
      "project.value",
      "Add at least one real value input before generating a proposal.",
    );
  }
}

function validateProposalDraftTemplateIds(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): boolean {
  return validateArray(input, path, errors, { minLength: 1 }, (item, itemPath) => {
    if (!isProposalDraftTemplateId(item)) {
      addError(errors, itemPath, `Must be one of: ${PROPOSAL_DRAFT_TEMPLATE_IDS.join(", ")}.`);
    }
  });
}

function validateProposalDraftMetadata(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalDraftMetadata {
  if (!isRecord(input)) {
    addError(errors, path, "Draft metadata must be an object.");
    return false;
  }

  validateRequiredString(input, "draftId", `${path}.draftId`, errors);
  validateNumber(input.version, `${path}.version`, errors, {
    integer: true,
    minInclusive: 1,
    label: "Draft version",
  });
  validateOptionalEnum(
    input,
    "status",
    `${path}.status`,
    PROPOSAL_DRAFT_STATUSES,
    "Draft status",
    errors,
  );
  validateOptionalString(input, "createdAt", `${path}.createdAt`, errors);
  validateOptionalString(input, "updatedAt", `${path}.updatedAt`, errors);
  validateOptionalString(input, "author", `${path}.author`, errors);
  validateOptionalString(input, "source", `${path}.source`, errors);
  validateOptionalStringArray(input.notes, `${path}.notes`, errors);

  return true;
}

function validatePreparedFor(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is PreparedFor {
  if (!isRecord(input)) {
    addError(errors, path, "Prepared-for metadata must be an object.");
    return false;
  }

  validateRequiredString(input, "companyName", `${path}.companyName`, errors);
  validateOptionalString(input, "buyerName", `${path}.buyerName`, errors);
  validateOptionalString(input, "buyerTitle", `${path}.buyerTitle`, errors);
  validateOptionalString(input, "website", `${path}.website`, errors);
  validateOptionalString(input, "logoText", `${path}.logoText`, errors);
  validateOptionalString(input, "accentColor", `${path}.accentColor`, errors);

  return true;
}

function validateProposalDetails(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalDetails {
  if (!isRecord(input)) {
    addError(errors, path, "Proposal details must be an object.");
    return false;
  }

  validateRequiredString(input, "title", `${path}.title`, errors);
  validateOptionalString(input, "subtitle", `${path}.subtitle`, errors);
  validateOptionalString(input, "date", `${path}.date`, errors);
  validateRequiredString(input, "recommendation", `${path}.recommendation`, errors);
  validateRequiredStringArray(input.executiveSummary, `${path}.executiveSummary`, errors);
  validateRequiredStringArray(input.whatWeHeard, `${path}.whatWeHeard`, errors);
  validateOptionalString(input, "investmentSummary", `${path}.investmentSummary`, errors);
  validateOptionalString(input, "timelineSummary", `${path}.timelineSummary`, errors);

  return true;
}

function validateProposalDraftValueProposal(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalDraftValueProposal {
  if (!isRecord(input)) {
    addError(errors, path, "Value proposal must be an object.");
    return false;
  }

  validateRequiredString(input, "headline", `${path}.headline`, errors);
  validateOptionalString(input, "narrative", `${path}.narrative`, errors);
  validateRequiredStringArray(input.unlocks, `${path}.unlocks`, errors);
  validateArray(
    input.valueSources,
    `${path}.valueSources`,
    errors,
    { minLength: 1 },
    (item, itemPath) => {
      validateProposalValueSourceRow(item, itemPath, errors);
    },
  );
  validateRange(input.sixMonthSavings, `${path}.sixMonthSavings`, errors, {
    label: "Six-month savings",
    minInclusive: 0,
  });
  validateNumber(input.annualValueTarget, `${path}.annualValueTarget`, errors, {
    label: "Annual value target",
    minExclusive: 0,
  });

  return true;
}

function validateProposalValueSourceRow(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalValueSourceRow {
  if (!isRecord(input)) {
    addError(errors, path, "Value-source row must be an object.");
    return false;
  }

  validateRequiredString(input, "label", `${path}.label`, errors);
  validateRequiredString(input, "source", `${path}.source`, errors);
  validateRequiredString(input, "currentState", `${path}.currentState`, errors);
  validateRequiredString(input, "futureState", `${path}.futureState`, errors);
  validateRange(input.annualValue, `${path}.annualValue`, errors, {
    label: "Annual value",
    minInclusive: 0,
  });
  validateOptionalEnum(
    input,
    "confidence",
    `${path}.confidence`,
    VALUE_SOURCE_CONFIDENCES,
    "Confidence",
    errors,
  );

  return true;
}

function validateProposalBuildPlanStep(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalBuildPlanStep {
  if (!isRecord(input)) {
    addError(errors, path, "Build-plan step must be an object.");
    return false;
  }

  validateRequiredString(input, "name", `${path}.name`, errors);
  validateRequiredString(input, "timing", `${path}.timing`, errors);
  validateRequiredString(input, "description", `${path}.description`, errors);
  validateRequiredStringArray(input.activities, `${path}.activities`, errors);
  validateRequiredStringArray(input.outcomes, `${path}.outcomes`, errors);

  return true;
}

function validateProposalActualDeliverable(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalActualDeliverable {
  if (!isRecord(input)) {
    addError(errors, path, "Actual deliverable must be an object.");
    return false;
  }

  validateRequiredString(input, "title", `${path}.title`, errors);
  validateRequiredString(input, "description", `${path}.description`, errors);
  validateRequiredStringArray(input.included, `${path}.included`, errors);
  validateOptionalStringArray(input.acceptanceCriteria, `${path}.acceptanceCriteria`, errors, {
    minLength: 1,
  });

  return true;
}

function validateProposalDraftPricing(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalDraftPricing {
  if (!isRecord(input)) {
    addError(errors, path, "Draft pricing must be an object.");
    return false;
  }

  validateRequiredString(input, "summary", `${path}.summary`, errors);
  const phasesValid = validateArray(
    input.phases,
    `${path}.phases`,
    errors,
    { minLength: 1 },
    (item, itemPath) => {
      validateProposalPricingPhase(item, itemPath, errors);
    },
  );

  if (phasesValid && !hasPricedPhase(input.phases)) {
    addError(
      errors,
      `${path}.phases`,
      "Add at least one priced phase before generating a proposal.",
    );
  }

  return true;
}

function validateProposalPricingPhase(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalPricingPhase {
  if (!isRecord(input)) {
    addError(errors, path, "Pricing phase must be an object.");
    return false;
  }

  validateRequiredString(input, "name", `${path}.name`, errors);
  if (input.price !== null) {
    validateNumber(input.price, `${path}.price`, errors, {
      minExclusive: 0,
      label: "Phase price",
    });
  }
  validateOptionalString(input, "note", `${path}.note`, errors);
  validateOptionalArray(
    input.discounts,
    `${path}.discounts`,
    errors,
    { minLength: 1 },
    (item, itemPath) => {
      validateProposalPhaseDiscount(item, itemPath, errors);
    },
  );

  return true;
}

function validateProposalPhaseDiscount(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalPhaseDiscount {
  if (!isRecord(input)) {
    addError(errors, path, "Phase discount must be an object.");
    return false;
  }

  validateRequiredString(input, "label", `${path}.label`, errors);
  validateNumber(input.amount, `${path}.amount`, errors, {
    minExclusive: 0,
    label: "Discount amount",
  });
  validateOptionalString(input, "reason", `${path}.reason`, errors);

  return true;
}

function validateProposalTerms(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalTerms {
  if (!isRecord(input)) {
    addError(errors, path, "Proposal terms must be an object.");
    return false;
  }

  validateRequiredString(input, "paymentTerms", `${path}.paymentTerms`, errors);
  validateRequiredStringArray(input.startConditions, `${path}.startConditions`, errors);
  validateRequiredStringArray(input.assumptions, `${path}.assumptions`, errors);
  validateRequiredStringArray(input.exclusions, `${path}.exclusions`, errors);
  validateRequiredStringArray(
    input.clientResponsibilities,
    `${path}.clientResponsibilities`,
    errors,
  );
  validateOptionalString(input, "changeControl", `${path}.changeControl`, errors);
  validateOptionalString(input, "expiration", `${path}.expiration`, errors);

  return true;
}

function validateProposalFooter(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalFooter {
  if (!isRecord(input)) {
    addError(errors, path, "Proposal footer must be an object.");
    return false;
  }

  validateRequiredString(input, "confidentiality", `${path}.confidentiality`, errors);
  validateOptionalString(input, "contact", `${path}.contact`, errors);
  validateOptionalString(input, "legal", `${path}.legal`, errors);

  return true;
}

function validateProposalScopeItem(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalScopeItem {
  if (!isRecord(input)) {
    addError(errors, path, "Scope item must be an object.");
    return false;
  }

  validateRequiredString(input, "title", `${path}.title`, errors);
  validateRequiredString(input, "description", `${path}.description`, errors);
  validateRequiredStringArray(input.deliverables, `${path}.deliverables`, errors);
  validateOptionalStringArray(input.outcomes, `${path}.outcomes`, errors, { minLength: 1 });

  return true;
}

function validateProposalMilestone(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): input is ProposalMilestone {
  if (!isRecord(input)) {
    addError(errors, path, "Milestone must be an object.");
    return false;
  }

  validateRequiredString(input, "name", `${path}.name`, errors);
  validateRequiredString(input, "timing", `${path}.timing`, errors);
  validateRequiredStringArray(input.outcomes, `${path}.outcomes`, errors);

  return true;
}

interface ArrayOptions {
  readonly minLength?: number;
}

function validateArray(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
  options: ArrayOptions,
  validateItem: (item: unknown, itemPath: string) => void,
): input is readonly unknown[] {
  if (!Array.isArray(input)) {
    addError(errors, path, "Must be an array.");
    return false;
  }

  if (options.minLength !== undefined && input.length < options.minLength) {
    addError(errors, path, `Must contain at least ${options.minLength} item.`);
  }

  input.forEach((item, index) => {
    validateItem(item, `${path}[${index}]`);
  });
  return true;
}

function validateOptionalArray(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
  options: ArrayOptions,
  validateItem: (item: unknown, itemPath: string) => void,
): input is readonly unknown[] | undefined {
  if (input === undefined) return true;
  return validateArray(input, path, errors, options, validateItem);
}

function validateRequiredStringArray(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
): boolean {
  return validateStringArray(input, path, errors, { minLength: 1 });
}

function validateOptionalStringArray(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
  options: ArrayOptions = {},
): boolean {
  if (input === undefined) return true;
  return validateStringArray(input, path, errors, options);
}

function validateStringArray(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
  options: ArrayOptions,
): boolean {
  return validateArray(input, path, errors, options, (item, itemPath) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      addError(errors, itemPath, "Must be a non-empty string.");
    }
  });
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MutableProposalValidationErrorList,
): boolean {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(errors, path, "Must be a non-empty string.");
    return false;
  }
  return true;
}

function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MutableProposalValidationErrorList,
): boolean {
  const value = input[key];
  if (value === undefined) return true;
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(errors, path, "Must be a non-empty string when provided.");
    return false;
  }
  return true;
}

function validateOptionalEnum<TValue extends string>(
  input: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  values: readonly TValue[],
  label: string,
  errors: MutableProposalValidationErrorList,
): boolean {
  const value = input[key];
  if (value === undefined) return true;
  if (typeof value !== "string" || !values.some((candidate) => candidate === value)) {
    addError(errors, path, `${label} must be one of: ${values.join(", ")}.`);
    return false;
  }
  return true;
}

interface NumberBounds {
  readonly minExclusive?: number;
  readonly minInclusive?: number;
  readonly maxExclusive?: number;
  readonly maxInclusive?: number;
  readonly integer?: boolean;
  readonly label?: string;
}

function validateNumber(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
  bounds: NumberBounds = {},
): boolean {
  const label = bounds.label ?? "Value";
  if (!isFiniteNumber(input)) {
    addError(errors, path, `${label} must be a finite number.`);
    return false;
  }

  if (bounds.integer === true && !Number.isInteger(input)) {
    addError(errors, path, `${label} must be an integer.`);
  }
  if (bounds.minExclusive !== undefined && input <= bounds.minExclusive) {
    addError(errors, path, `${label} must be greater than ${bounds.minExclusive}.`);
  }
  if (bounds.minInclusive !== undefined && input < bounds.minInclusive) {
    addError(errors, path, `${label} must be at least ${bounds.minInclusive}.`);
  }
  if (bounds.maxExclusive !== undefined && input >= bounds.maxExclusive) {
    addError(errors, path, `${label} must be less than ${bounds.maxExclusive}.`);
  }
  if (bounds.maxInclusive !== undefined && input > bounds.maxInclusive) {
    addError(errors, path, `${label} must be at most ${bounds.maxInclusive}.`);
  }

  return true;
}

function validateRange(
  input: unknown,
  path: string,
  errors: MutableProposalValidationErrorList,
  options: NumberBounds & { readonly label: string },
): input is Range {
  if (!isRecord(input)) {
    addError(errors, path, `${options.label} must be an object.`);
    return false;
  }

  validateNumber(input.low, `${path}.low`, errors, options);
  validateNumber(input.high, `${path}.high`, errors, options);

  if (isFiniteNumber(input.low) && isFiniteNumber(input.high) && input.low > input.high) {
    addError(errors, path, `${options.label} must be ordered low <= high.`);
  }

  return true;
}

function hasPricedPhase(input: unknown): boolean {
  if (!Array.isArray(input)) return false;
  return input.some((item) => {
    if (!isRecord(item)) return false;
    return isFiniteNumber(item.price) && item.price > 0;
  });
}

function isProposalDraftTemplateId(input: unknown): input is ProposalDraftTemplateId {
  return typeof input === "string" && PROPOSAL_DRAFT_TEMPLATE_IDS.some((id) => id === input);
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

function addError(errors: MutableProposalValidationErrorList, path: string, message: string): void {
  errors.push({ path, message });
}

function validationFailure(errors: readonly ProposalValidationError[]): ValidationResult<never> {
  return { ok: false, errors };
}

function actualDeliverableToScopeItem(deliverable: ProposalActualDeliverable): ProposalScopeItem {
  return {
    title: deliverable.title,
    description: deliverable.description,
    deliverables: deliverable.included,
    ...(deliverable.acceptanceCriteria === undefined
      ? {}
      : { outcomes: deliverable.acceptanceCriteria }),
  } satisfies ProposalScopeItem;
}

function buildPlanStepToMilestone(step: ProposalBuildPlanStep): ProposalMilestone {
  return {
    name: step.name,
    timing: step.timing,
    outcomes: step.outcomes,
  };
}

function pricingPhaseToTier(phase: ProposalPricingPhase): Tier {
  const note = pricingPhaseNote(phase);
  return {
    name: phase.name,
    price: phase.price,
    ...(note === undefined ? {} : { note }),
  } satisfies Tier;
}

function pricingPhaseNote(phase: ProposalPricingPhase): string | undefined {
  const noteParts: string[] = [];
  if (phase.note !== undefined) noteParts.push(phase.note);
  if (phase.discounts !== undefined && phase.discounts.length > 0) {
    noteParts.push(`Discounts: ${phase.discounts.map((discount) => discount.label).join(", ")}.`);
  }
  if (noteParts.length === 0) return undefined;
  return noteParts.join(" ");
}

function buildPlanTimelineSummary(steps: readonly ProposalBuildPlanStep[]): string {
  if (steps.length === 0) return "Build-plan timing is confirmed during kickoff.";
  return steps.map((step) => `${step.timing}: ${step.name}`).join(" → ");
}
