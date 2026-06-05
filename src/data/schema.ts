import type {
  ClientContext,
  CostModel,
  NamedRange,
  PricingModel,
  Project,
  Range,
  RoleSegment,
  Tier,
  TriEstimate,
  ValueModel,
  Workstream,
} from "../core/types.js";

export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

type MutableValidationErrorList = ValidationError[];

export function validateProject(input: unknown): ValidationResult<Project> {
  const errors: MutableValidationErrorList = [];

  if (!isRecord(input)) {
    return validationFailure([{ path: "$", message: "Project must be an object." }]);
  }

  validateRequiredString(input, "project", "project", errors);
  validateClientContext(input.client, "client", errors);
  validateCostModel(input.cost, "cost", errors);
  validateValueModel(input.value, "value", errors);
  validatePricingModel(input.pricing, "pricing", errors);

  if (errors.length > 0) return validationFailure(errors);
  return { ok: true, value: input as unknown as Project };
}

function validateClientContext(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
): input is ClientContext {
  if (!isRecord(input)) {
    addError(errors, path, "Client context must be an object.");
    return false;
  }

  validateNumber(input.sizeHeadcount, `${path}.sizeHeadcount`, errors, {
    integer: true,
    minExclusive: 0,
    label: "Client headcount",
  });
  validateRequiredString(input, "buyerRole", `${path}.buyerRole`, errors);
  validateNumber(input.workingWeeks, `${path}.workingWeeks`, errors, {
    minExclusive: 0,
    maxInclusive: 52,
    label: "Working weeks",
  });

  return true;
}

function validateCostModel(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
): input is CostModel {
  if (!isRecord(input)) {
    addError(errors, path, "Cost model must be an object.");
    return false;
  }

  validateTriEstimate(input.blendedRate, `${path}.blendedRate`, errors, {
    label: "Blended rate",
    minExclusive: 0,
  });
  validateNumber(input.margin, `${path}.margin`, errors, {
    minInclusive: 0,
    maxExclusive: 1,
    label: "Margin",
  });
  validateArray(input.workstreams, `${path}.workstreams`, errors, (item, itemPath) => {
    validateWorkstream(item, itemPath, errors);
  });

  return true;
}

function validateWorkstream(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
): input is Workstream {
  if (!isRecord(input)) {
    addError(errors, path, "Workstream must be an object.");
    return false;
  }

  validateRequiredString(input, "name", `${path}.name`, errors);
  validateTriEstimate(input.hours, `${path}.hours`, errors, {
    label: "Workstream hours",
    minExclusive: 0,
  });
  validateNumber(input.aiFactor, `${path}.aiFactor`, errors, {
    minExclusive: 0,
    maxInclusive: 1,
    label: "AI factor",
  });
  validateBoolean(input.judgment, `${path}.judgment`, errors);

  return true;
}

function validateValueModel(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
): input is ValueModel {
  if (!isRecord(input)) {
    addError(errors, path, "Value model must be an object.");
    return false;
  }

  validateRange(input.realizationFactor, `${path}.realizationFactor`, errors, {
    label: "Realization factor",
    minExclusive: 0,
    maxInclusive: 1,
  });
  validateArray(input.segments, `${path}.segments`, errors, (item, itemPath) => {
    validateRoleSegment(item, itemPath, errors);
  });
  validateArray(input.workflows, `${path}.workflows`, errors, (item, itemPath) => {
    validateNamedRange(item, itemPath, errors, "Workflow value");
  });
  validateArray(input.futureUpside, `${path}.futureUpside`, errors, (item, itemPath) => {
    validateNamedRange(item, itemPath, errors, "Future upside");
  });

  return true;
}

function validateRoleSegment(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
): input is RoleSegment {
  if (!isRecord(input)) {
    addError(errors, path, "Role segment must be an object.");
    return false;
  }

  validateRequiredString(input, "role", `${path}.role`, errors);
  validateNumber(input.headcount, `${path}.headcount`, errors, {
    minExclusive: 0,
    label: "Segment headcount",
  });
  validateNumber(input.hoursPerWeek, `${path}.hoursPerWeek`, errors, {
    minExclusive: 0,
    maxInclusive: 168,
    label: "Hours per week",
  });
  validateNumber(input.loadedRate, `${path}.loadedRate`, errors, {
    minExclusive: 0,
    label: "Loaded rate",
  });

  return true;
}

function validatePricingModel(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
): input is PricingModel {
  if (!isRecord(input)) {
    addError(errors, path, "Pricing model must be an object.");
    return false;
  }

  validateRange(input.valueFraction, `${path}.valueFraction`, errors, {
    label: "Value fraction",
    minExclusive: 0,
    maxInclusive: 1,
  });
  validateArray(input.tiers, `${path}.tiers`, errors, (item, itemPath) => {
    validateTier(item, itemPath, errors);
  });

  return true;
}

function validateTier(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
): input is Tier {
  if (!isRecord(input)) {
    addError(errors, path, "Pricing tier must be an object.");
    return false;
  }

  validateRequiredString(input, "name", `${path}.name`, errors);
  if (input.price !== null) {
    validateNumber(input.price, `${path}.price`, errors, {
      minExclusive: 0,
      label: "Tier price",
    });
  }
  validateOptionalString(input, "note", `${path}.note`, errors);

  return true;
}

function validateNamedRange(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
  label: string,
): input is NamedRange {
  if (!isRecord(input)) {
    addError(errors, path, `${label} must be an object.`);
    return false;
  }

  validateRequiredString(input, "name", `${path}.name`, errors);
  validateRange(input, path, errors, {
    label,
    minInclusive: 0,
  });
  validateOptionalString(input, "note", `${path}.note`, errors);

  return true;
}

function validateTriEstimate(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
  options: NumberBounds & { readonly label: string },
): input is TriEstimate {
  if (!isRecord(input)) {
    addError(errors, path, `${options.label} must be an object.`);
    return false;
  }

  validateNumber(input.optimistic, `${path}.optimistic`, errors, options);
  validateNumber(input.likely, `${path}.likely`, errors, options);
  validateNumber(input.pessimistic, `${path}.pessimistic`, errors, options);

  if (
    isFiniteNumber(input.optimistic) &&
    isFiniteNumber(input.likely) &&
    isFiniteNumber(input.pessimistic) &&
    (input.optimistic > input.likely || input.likely > input.pessimistic)
  ) {
    addError(errors, path, `${options.label} must be ordered optimistic <= likely <= pessimistic.`);
  }

  return true;
}

function validateRange(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
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

function validateArray(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
  validateItem: (item: unknown, itemPath: string) => void,
): boolean {
  if (!Array.isArray(input)) {
    addError(errors, path, "Must be an array.");
    return false;
  }

  input.forEach((item, index) => {
    validateItem(item, `${path}[${index}]`);
  });
  return true;
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: MutableValidationErrorList,
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
  errors: MutableValidationErrorList,
): boolean {
  const value = input[key];
  if (value === undefined) return true;
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(errors, path, "Must be a non-empty string when provided.");
    return false;
  }
  return true;
}

function validateBoolean(
  input: unknown,
  path: string,
  errors: MutableValidationErrorList,
): boolean {
  if (typeof input !== "boolean") {
    addError(errors, path, "Must be a boolean.");
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
  errors: MutableValidationErrorList,
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

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

function addError(errors: MutableValidationErrorList, path: string, message: string): void {
  errors.push({ path, message });
}

function validationFailure(errors: readonly ValidationError[]): ValidationResult<never> {
  return { ok: false, errors };
}
