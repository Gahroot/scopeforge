/**
 * Extract style information from reference PDF text and produce a structured
 * StylePreset. This is best-effort: complex or image-heavy PDFs may not yield
 * clean section detection, in which case a generic fallback is returned.
 */

import type {
  DataDensity,
  FormalityLevel,
  NarrativeWeight,
  SectionLayout,
  StylePreset,
  StylePresetLayout,
  StylePresetSection,
} from "./stylePreset.js";

// ---- Known section patterns from the Triten reference ----------------------

const KNOWN_SECTIONS: readonly {
  readonly pattern: RegExp;
  readonly id: string;
  readonly layout: SectionLayout;
}[] = [
  { pattern: /^0?1\s+What (?:this|your) (?:unlocks?|system)/i, id: "value-unlocks", layout: "two-column" },
  { pattern: /^0?2\s+What we build/i, id: "build-plan", layout: "four-column" },
  { pattern: /^0?3\s+How we keep it practical/i, id: "principles", layout: "two-column" },
  { pattern: /^0?4\s+What you(?:'ll| will) actually have/i, id: "actual-deliverables", layout: "two-column" },
  { pattern: /^0?5\s+Your investment/i, id: "investment-next-steps", layout: "three-column" },
  { pattern: /^0?6\s+Next steps/i, id: "next-steps", layout: "full-width" },
  // Generic fallbacks
  { pattern: /^(?:Cover|Title\s*Page)/i, id: "cover", layout: "cover" },
  { pattern: /^(?:Executive\s+Summary|Overview)/i, id: "executive-summary", layout: "full-width" },
  { pattern: /^(?:Scope|Deliverables?|Work\s*Plan)/i, id: "scope", layout: "two-column" },
  { pattern: /^(?:Timeline|Roadmap|Milestones?)/i, id: "timeline", layout: "full-width" },
  { pattern: /^(?:Pricing|Investment|Cost|Budget)/i, id: "investment", layout: "three-column" },
  { pattern: /^(?:Terms|Conditions?|Appendix)/i, id: "terms", layout: "full-width" },
];

// ---- Tone analysis helpers -------------------------------------------------

const FORMAL_MARKERS = [
  "herein",
  "aforementioned",
  "pursuant",
  "shall",
  "whereby",
  "notwithstanding",
  "hereunder",
  "therein",
];

const CONVERSATIONAL_MARKERS = [
  "let's",
  "we'll",
  "you'll",
  "here's",
  "that's",
  "what's",
  "it's",
  "we've",
  "you've",
];

const TECHNICAL_MARKERS = [
  "api",
  "mcp",
  "oauth",
  "pipeline",
  "architecture",
  "latency",
  "throughput",
  "ingestion",
  "schema",
  "webhook",
];

// ---- Public API ------------------------------------------------------------

export interface ExtractStyleOptions {
  /** Name to assign the extracted preset. */
  readonly presetName?: string;
  /** Description to assign. */
  readonly description?: string;
  /** Source file path for provenance. */
  readonly sourcePath?: string;
}

/**
 * Extract a StylePreset from the raw text of a reference PDF.
 *
 * Detection is heuristic: section headings are matched by regex, tone is
 * scored by marker frequency, and layout parameters are estimated from
 * text length and section count.
 */
export function extractStyleFromText(
  text: string,
  options: ExtractStyleOptions = {},
): StylePreset {
  const lines = text.split("\n");
  const sections = detectSections(lines);
  const tone = analyzeTone(text);
  const pageCount = estimatePageCount(text, sections);
  const css = inferCssFromSections(sections);
  const layout = inferLayout(pageCount, sections);

  return {
    id: "custom",
    name: options.presetName ?? "Custom Reference Style",
    description:
      options.description ??
      `Extracted from reference document (${sections.length} sections detected, ~${pageCount} pages).`,
    ...(options.sourcePath === undefined ? {} : { source: options.sourcePath }),
    sections,
    tone,
    css,
    layout,
  };
}

/**
 * Extract a StylePreset from already-extracted PDF text. Falls back to a
 * generic preset if text is empty.
 */
export function extractStyleFromPdfText(
  text: string,
  options: ExtractStyleOptions = {},
): StylePreset {
  if (text.trim().length === 0) {
    return fallbackPreset(options);
  }
  return extractStyleFromText(text, options);
}

// ---- Section detection -----------------------------------------------------

function detectSections(lines: readonly string[]): readonly StylePresetSection[] {
  const found: StylePresetSection[] = [];
  let order = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 120) continue;

    for (const known of KNOWN_SECTIONS) {
      if (known.pattern.test(trimmed)) {
        // Avoid duplicate section IDs
        if (found.some((s) => s.id === known.id)) continue;

        found.push({
          id: known.id,
          label: trimmed,
          layout: known.layout,
          required: known.id === "cover",
          order: order++,
        });
        break;
      }
    }
  }

  // Always include cover if not detected
  if (!found.some((s) => s.id === "cover")) {
    found.unshift({
      id: "cover",
      label: "Cover",
      layout: "cover",
      required: true,
      order: 0,
    });
    // Re-number
    for (let i = 0; i < found.length; i++) {
      const section = found[i];
      if (section !== undefined) {
        found[i] = { ...section, order: i };
      }
    }
  }

  return found;
}

// ---- Tone analysis ---------------------------------------------------------

function analyzeTone(text: string): {
  readonly formality: FormalityLevel;
  readonly dataDensity: DataDensity;
  readonly narrativeWeight: NarrativeWeight;
} {
  const lower = text.toLowerCase();
  const wordCount = estimateWordCount(text);

  const formalScore = countOccurrences(lower, FORMAL_MARKERS);
  const conversationalScore = countOccurrences(lower, CONVERSATIONAL_MARKERS);
  const technicalScore = countOccurrences(lower, TECHNICAL_MARKERS);

  // Data density: look for numbers, dollar signs, percentages
  const numberMatches = text.match(/\$[\d,]+|[\d,]+%|\d{1,3}(?:,\d{3})+/g);
  const numberDensity = numberMatches !== null ? numberMatches.length / Math.max(1, wordCount / 100) : 0;

  let formality: FormalityLevel = "conversational";
  if (formalScore > conversationalScore * 2 && formalScore > 3) {
    formality = "formal";
  } else if (technicalScore > 5) {
    formality = "technical";
  }

  let dataDensity: DataDensity = "medium";
  if (numberDensity > 5) {
    dataDensity = "high";
  } else if (numberDensity < 1) {
    dataDensity = "low";
  }

  // Narrative weight: average sentence length
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const avgSentenceLength = wordCount / Math.max(1, sentences.length);
  let narrativeWeight: NarrativeWeight = "balanced";
  if (avgSentenceLength > 25) {
    narrativeWeight = "heavy";
  } else if (avgSentenceLength < 12) {
    narrativeWeight = "minimal";
  }

  return { formality, dataDensity, narrativeWeight };
}

// ---- Page count estimation --------------------------------------------------

function estimatePageCount(
  text: string,
  sections: readonly StylePresetSection[],
): number {
  // Rough heuristic: ~3000 characters per page for a dense proposal
  const charsPerPage = 3000;
  const estimatedFromLength = Math.max(3, Math.ceil(text.length / charsPerPage));

  // If we detected sections, at least one page per section
  const minimumFromSections = Math.max(3, sections.length);

  return Math.min(
    Math.max(estimatedFromLength, minimumFromSections),
    12, // cap at 12 pages
  );
}

// ---- CSS inference from sections -------------------------------------------

function inferCssFromSections(
  sections: readonly StylePresetSection[],
): StylePreset["css"] {
  const hasFourColumn = sections.some((s) => s.layout === "four-column");
  const hasDiagram = sections.some((s) => s.layout === "diagram");

  // If the reference has 4-column layouts (like Triten's build diagram),
  // use the Triten-style CSS. Otherwise, use a cleaner layout.
  if (hasFourColumn || hasDiagram) {
    return {
      coverGradient:
        "radial-gradient(circle at 96% 6%, rgba(125, 211, 252, 0.16), transparent 28rem), " +
        "linear-gradient(158deg, #052f45 0%, #063e5c 54%, #0b6388 100%)",
      accentColor: "#0c5a7d",
      borderRadius: "16px",
      pagePadding: "70px 68px 54px",
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      headingScale: "28px",
      bodyScale: "16px",
      tableStyle: "lined",
      cardStyle: "outlined",
    };
  }

  return {
    coverGradient: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
    accentColor: "#2563eb",
    borderRadius: "12px",
    pagePadding: "56px 56px 48px",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    headingScale: "24px",
    bodyScale: "15px",
    tableStyle: "bordered",
    cardStyle: "bordered",
  };
}

// ---- Layout inference ------------------------------------------------------

function inferLayout(
  pageCount: number,
  sections: readonly StylePresetSection[],
): StylePresetLayout {
  const hasFourColumn = sections.some((s) => s.layout === "four-column");
  const metricStripColumns = hasFourColumn ? 3 : 3;

  return {
    pageCount,
    coverHeight: pageCount <= 4 ? "960px" : "1056px",
    coverLayout: hasFourColumn ? "full-bleed" : "centered",
    footerStyle: "brand-left",
    metricStripColumns,
  };
}

// ---- Fallback preset -------------------------------------------------------

function fallbackPreset(options: ExtractStyleOptions): StylePreset {
  return {
    id: "custom",
    name: options.presetName ?? "Custom Reference Style",
    description: "Fallback preset — could not extract style from the reference document.",
    ...(options.sourcePath === undefined ? {} : { source: options.sourcePath }),
    sections: [
      { id: "cover", label: "Cover", layout: "cover", required: true, order: 0 },
      { id: "value-unlocks", label: "Value overview", layout: "full-width", required: true, order: 1 },
      { id: "build-plan", label: "Scope & plan", layout: "two-column", required: true, order: 2 },
      { id: "actual-deliverables", label: "Deliverables", layout: "full-width", required: true, order: 3 },
      { id: "investment-next-steps", label: "Investment", layout: "three-column", required: true, order: 4 },
    ],
    tone: { formality: "conversational", dataDensity: "medium", narrativeWeight: "balanced" },
    css: {
      coverGradient: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
      accentColor: "#2563eb",
      borderRadius: "12px",
      pagePadding: "56px 56px 48px",
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
}

// ---- Helpers ---------------------------------------------------------------

function estimateWordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function countOccurrences(haystack: string, needles: readonly string[]): number {
  let count = 0;
  for (const needle of needles) {
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      count++;
      index = haystack.indexOf(needle, index + needle.length);
    }
  }
  return count;
}
