/**
 * Style presets capture the structural DNA of a reference proposal:
 * section ordering, tone, CSS overrides, layout hints, and component patterns.
 *
 * A StylePreset does NOT carry content or brand colors — those live in
 * ProposalDraft and ProposalBrand respectively. This module is purely about
 * the *shape* of the rendered document.
 */

import type { ProposalValidationError, ValidationResult } from "./types.js";

// ---- Section layout patterns ------------------------------------------------

export type SectionLayout =
  | "cover"
  | "two-column"
  | "three-column"
  | "four-column"
  | "full-width"
  | "table"
  | "cards"
  | "diagram"
  | "banner"
  | "grid";

// ---- Preset section definition ---------------------------------------------

export interface StylePresetSection {
  /** Stable ID — must match data-page attributes in the renderer. */
  readonly id: string;
  /** Human-readable label, e.g. "01 What this unlocks". */
  readonly label: string;
  /** How the section's content is laid out. */
  readonly layout: SectionLayout;
  /** Whether this section must appear in the rendered output. */
  readonly required: boolean;
  /** Display order (0-based). */
  readonly order: number;
}

// ---- Tone markers ----------------------------------------------------------

export type FormalityLevel = "formal" | "conversational" | "technical";
export type DataDensity = "high" | "medium" | "low";
export type NarrativeWeight = "heavy" | "balanced" | "minimal";

export interface StylePresetTone {
  readonly formality: FormalityLevel;
  readonly dataDensity: DataDensity;
  readonly narrativeWeight: NarrativeWeight;
}

// ---- CSS overrides ---------------------------------------------------------

export interface StylePresetCssOverrides {
  /** CSS gradient string for the cover background. */
  readonly coverGradient: string;
  /** Primary accent color (hex). */
  readonly accentColor: string;
  /** Border radius for cards, sections, and containers. */
  readonly borderRadius: string;
  /** Inner page padding. */
  readonly pagePadding: string;
  /** Font stack. */
  readonly fontFamily: string;
  /** H1 font size. */
  readonly headingScale: string;
  /** Body paragraph font size. */
  readonly bodyScale: string;
  /** Table visual style. */
  readonly tableStyle: "lined" | "bordered" | "minimal";
  /** Card visual style. */
  readonly cardStyle: "outlined" | "bordered" | "filled" | "shadowed";
}

// ---- Layout hints ----------------------------------------------------------

export type CoverLayout = "full-bleed" | "centered" | "split";
export type FooterStyle = "brand-left" | "centered" | "minimal";

export interface StylePresetLayout {
  /** Expected page count for the rendered document. */
  readonly pageCount: number;
  /** Cover section min-height CSS value. */
  readonly coverHeight: string;
  /** Cover layout variant. */
  readonly coverLayout: CoverLayout;
  /** Footer placement/branding style. */
  readonly footerStyle: FooterStyle;
  /** Number of columns in the metric strip on the cover. */
  readonly metricStripColumns: number;
}

// ---- The preset itself -----------------------------------------------------

export interface StylePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Original PDF path or "built-in". */
  readonly source?: string;
  readonly sections: readonly StylePresetSection[];
  readonly tone: StylePresetTone;
  readonly css: StylePresetCssOverrides;
  readonly layout: StylePresetLayout;
}

// ---- Validation ------------------------------------------------------------

export function validateStylePreset(input: unknown): ValidationResult<StylePreset> {
  const errors: ProposalValidationError[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: "$", message: "Style preset must be an object." }] };
  }

  validateRequiredString(input, "id", errors);
  validateRequiredString(input, "name", errors);
  validateRequiredString(input, "description", errors);

  if (!Array.isArray(input.sections)) {
    errors.push({ path: "sections", message: "Must be an array." });
  } else {
    for (let i = 0; i < input.sections.length; i++) {
      const section = input.sections[i];
      if (!isRecord(section)) {
        errors.push({ path: `sections[${i}]`, message: "Section must be an object." });
        continue;
      }
      validateRequiredString(section, "id", errors, `sections[${i}].id`);
      validateRequiredString(section, "label", errors, `sections[${i}].label`);
      validateRequiredString(section, "layout", errors, `sections[${i}].layout`);
      if (typeof section.required !== "boolean") {
        errors.push({ path: `sections[${i}].required`, message: "Must be a boolean." });
      }
      if (typeof section.order !== "number") {
        errors.push({ path: `sections[${i}].order`, message: "Must be a number." });
      }
    }
  }

  if (!isRecord(input.tone)) {
    errors.push({ path: "tone", message: "Must be an object." });
  }

  if (!isRecord(input.css)) {
    errors.push({ path: "css", message: "Must be an object." });
  }

  if (!isRecord(input.layout)) {
    errors.push({ path: "layout", message: "Must be an object." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as StylePreset };
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  errors: ProposalValidationError[],
  path?: string,
): void {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path: path ?? key, message: "Must be a non-empty string." });
  }
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
