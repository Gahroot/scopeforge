/**
 * Built-in style presets. The Triten preset captures the exact structural DNA
 * of the reference value proposal; the generic preset is a clean, simpler
 * alternative. Users can also create custom presets from uploaded PDFs.
 */

import type { StylePreset } from "./stylePreset.js";

export const BUILT_IN_STYLE_PRESET_IDS = ["triten", "generic"] as const;
export type BuiltInStylePresetId = (typeof BUILT_IN_STYLE_PRESET_IDS)[number];

/**
 * The Triten-style value proposal preset — extracted from the reference
 * `Triten_Value_Proposal.pdf`. This is the default when no preset is specified.
 *
 * 5-page layout:
 *   1. Cover (full-bleed gradient, metric strip, footer)
 *   2. Value Unlocks + recovered-value table + savings box
 *   3. Build Plan (4-column diagram) + principles
 *   4. Actual Deliverables (2-column cards)
 *   5. Investment (3-column phase cards) + payback banner + next steps + terms
 */
export const TRITEN_STYLE_PRESET: StylePreset = {
  id: "triten",
  name: "Triten Value Proposal",
  description:
    "5-page value-led layout modeled on the Triten reference proposal. " +
    "Full-bleed cover, 4-step build diagram, 3-column phase cards, payback banner.",
  source: "built-in",
  sections: [
    { id: "cover", label: "Cover", layout: "cover", required: true, order: 0 },
    {
      id: "value-unlocks",
      label: "01 What this unlocks",
      layout: "two-column",
      required: true,
      order: 1,
    },
    {
      id: "build-plan",
      label: "02 What we build",
      layout: "four-column",
      required: true,
      order: 2,
    },
    {
      id: "actual-deliverables",
      label: "04 What you'll actually have",
      layout: "two-column",
      required: true,
      order: 3,
    },
    {
      id: "investment-next-steps",
      label: "05 Your investment",
      layout: "three-column",
      required: true,
      order: 4,
    },
  ],
  tone: {
    formality: "conversational",
    dataDensity: "high",
    narrativeWeight: "balanced",
  },
  css: {
    coverGradient:
      "radial-gradient(circle at 96% 6%, rgba(125, 211, 252, 0.16), transparent 28rem), " +
      "linear-gradient(158deg, #052f45 0%, #063e5c 54%, #0b6388 100%)",
    accentColor: "#0c5a7d",
    borderRadius: "16px",
    pagePadding: "70px 68px 54px",
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    headingScale: "28px",
    bodyScale: "16px",
    tableStyle: "lined",
    cardStyle: "outlined",
  },
  layout: {
    pageCount: 5,
    coverHeight: "1056px",
    coverLayout: "full-bleed",
    footerStyle: "brand-left",
    metricStripColumns: 3,
  },
};

/**
 * A clean, simpler generic preset — lighter visual weight, centered cover,
 * fewer decorative elements.
 */
export const GENERIC_STYLE_PRESET: StylePreset = {
  id: "generic",
  name: "Clean Professional",
  description:
    "A clean, minimal layout with centered cover, bordered cards, " +
    "and generous whitespace. Good for formal or executive audiences.",
  source: "built-in",
  sections: [
    { id: "cover", label: "Cover", layout: "cover", required: true, order: 0 },
    {
      id: "value-unlocks",
      label: "01 What this unlocks",
      layout: "full-width",
      required: true,
      order: 1,
    },
    {
      id: "build-plan",
      label: "02 What we build",
      layout: "two-column",
      required: true,
      order: 2,
    },
    {
      id: "actual-deliverables",
      label: "03 What you'll actually have",
      layout: "full-width",
      required: true,
      order: 3,
    },
    {
      id: "investment-next-steps",
      label: "04 Your investment",
      layout: "three-column",
      required: true,
      order: 4,
    },
  ],
  tone: {
    formality: "formal",
    dataDensity: "medium",
    narrativeWeight: "heavy",
  },
  css: {
    coverGradient:
      "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
    accentColor: "#2563eb",
    borderRadius: "12px",
    pagePadding: "56px 56px 48px",
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    headingScale: "24px",
    bodyScale: "15px",
    tableStyle: "bordered",
    cardStyle: "bordered",
  },
  layout: {
    pageCount: 5,
    coverHeight: "960px",
    coverLayout: "centered",
    footerStyle: "centered",
    metricStripColumns: 3,
  },
};

const BUILT_IN_STYLE_PRESETS: Record<BuiltInStylePresetId, StylePreset> = {
  triten: TRITEN_STYLE_PRESET,
  generic: GENERIC_STYLE_PRESET,
};

export function isBuiltInStylePresetId(input: string): input is BuiltInStylePresetId {
  return (BUILT_IN_STYLE_PRESET_IDS as readonly string[]).includes(input);
}

export function getBuiltInStylePresets(): readonly StylePreset[] {
  return BUILT_IN_STYLE_PRESET_IDS.map((id) => BUILT_IN_STYLE_PRESETS[id]);
}

export function resolveStylePreset(
  idOrPreset: string | StylePreset,
): StylePreset | null {
  if (typeof idOrPreset !== "string") return idOrPreset;
  if (!isBuiltInStylePresetId(idOrPreset)) return null;
  return BUILT_IN_STYLE_PRESETS[idOrPreset];
}
