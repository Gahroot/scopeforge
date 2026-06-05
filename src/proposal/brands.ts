import type { ProposalBrand, ProposalValidationError, ValidationResult } from "./types.js";

export const BUILT_IN_BRAND_IDS = ["nolan", "partners"] as const;
export type BuiltInBrandId = (typeof BUILT_IN_BRAND_IDS)[number];

export const BUILT_IN_BRANDS = {
  nolan: {
    id: "nolan",
    name: "Nolan Grout",
    legalName: "Nolan Grout",
    tagline: "AI systems, scoped honestly and built to pay back.",
    website: "https://nolango.com",
    email: "hello@nolango.com",
    logoText: "NG",
    colors: {
      primary: "#111827",
      secondary: "#334155",
      accent: "#2563eb",
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#111827",
      mutedText: "#64748b",
      border: "#dbe3ef",
    },
  },
  partners: {
    id: "partners",
    name: "ScopeForge Partners",
    legalName: "ScopeForge Partners LLC",
    tagline: "Outcome-based AI delivery for operating teams.",
    website: "https://scopeforge.local",
    email: "partners@scopeforge.local",
    logoText: "SFP",
    colors: {
      primary: "#0f172a",
      secondary: "#1e293b",
      accent: "#0f766e",
      background: "#f7f7f4",
      surface: "#ffffff",
      text: "#172033",
      mutedText: "#667085",
      border: "#d9e0e8",
    },
  },
} satisfies Record<BuiltInBrandId, ProposalBrand>;

export function isBuiltInBrandId(input: string): input is BuiltInBrandId {
  return BUILT_IN_BRAND_IDS.some((id) => id === input);
}

export function getBuiltInBrands(): readonly ProposalBrand[] {
  return BUILT_IN_BRAND_IDS.map((id) => BUILT_IN_BRANDS[id]);
}

export function resolveBrand(idOrProfile: string | ProposalBrand): ProposalBrand | null {
  if (typeof idOrProfile !== "string") return idOrProfile;
  if (!isBuiltInBrandId(idOrProfile)) return null;
  return BUILT_IN_BRANDS[idOrProfile];
}

export function validateProposalBrand(input: unknown): ValidationResult<ProposalBrand> {
  const errors: ProposalValidationError[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: "$", message: "Brand profile must be an object." }] };
  }

  validateRequiredString(input, "id", "id", errors);
  validateRequiredString(input, "name", "name", errors);
  validateOptionalString(input, "legalName", "legalName", errors);
  validateOptionalString(input, "tagline", "tagline", errors);
  validateOptionalString(input, "website", "website", errors);
  validateOptionalString(input, "email", "email", errors);
  validateOptionalString(input, "phone", "phone", errors);
  validateRequiredString(input, "logoText", "logoText", errors);

  if (!isRecord(input.colors)) {
    errors.push({ path: "colors", message: "Brand colors must be an object." });
  } else {
    for (const key of [
      "primary",
      "secondary",
      "accent",
      "background",
      "surface",
      "text",
      "mutedText",
      "border",
    ] as const) {
      validateRequiredString(input.colors, key, `colors.${key}`, errors);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as ProposalBrand };
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ProposalValidationError[],
): boolean {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path, message: "Must be a non-empty string." });
    return false;
  }
  return true;
}

function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  errors: ProposalValidationError[],
): boolean {
  const value = input[key];
  if (value === undefined) return true;
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path, message: "Must be a non-empty string when provided." });
    return false;
  }
  return true;
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
