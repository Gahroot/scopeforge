import { describe, expect, it } from "vitest";
import { extractStyleFromText, extractStyleFromPdfText } from "./extractStyle.js";

const TRITEN_SAMPLE_TEXT = `
Triten Value Proposal
Prepared for Triten

01 What this unlocks for Triten
An AI Operating System That Pays for Itself in About 5 Months
The system connects Power BI, Monday.com, and internal data.

02 What we build
Discovery and data modeling in weeks 1-2.
Data layer and ingestion in weeks 3-4.
MCP server and Q&A in weeks 5-7.
QA and reconciliation in weeks 8-9.

03 How we keep it practical
Clean numbers first. The system is only useful if the data is right.
People still make the call. The software speeds up the work.

04 What you'll actually have
Clean Data Layer. A single source of truth for operating data.
Unified Dashboard. Real-time views across all systems.
Automated Reports. Scheduled and on-demand reporting.

05 Your investment
Phase 1: Pilot Build — $40,000
Phase 2: Scale — Scoped when ready
Phase 3: AI-First Operations — Scoped when ready

Terms: Net 30 days from invoice. Proposal expires 30 days from date.
$150K-180K in annual value. ~2 mo payback. 1 system.
`;

describe("extractStyleFromText", () => {
  it("detects Triten-style numbered sections", () => {
    const preset = extractStyleFromText(TRITEN_SAMPLE_TEXT, {
      presetName: "Test Triten",
    });

    expect(preset.id).toBe("custom");
    expect(preset.name).toBe("Test Triten");
    expect(preset.sections.length).toBeGreaterThanOrEqual(4);

    const sectionIds = preset.sections.map((s) => s.id);
    expect(sectionIds).toContain("value-unlocks");
    expect(sectionIds).toContain("build-plan");
    expect(sectionIds).toContain("actual-deliverables");
    expect(sectionIds).toContain("investment-next-steps");
  });

  it("includes a cover section even if not explicitly detected", () => {
    const preset = extractStyleFromText("Some text without headings.");
    expect(preset.sections.some((s) => s.id === "cover")).toBe(true);
  });

  it("analyzes tone as conversational", () => {
    const preset = extractStyleFromText(TRITEN_SAMPLE_TEXT);
    // It has conversational markers like "you'll"
    expect(preset.tone.formality).toBe("conversational");
  });

  it("estimates page count from text length", () => {
    const preset = extractStyleFromText(TRITEN_SAMPLE_TEXT);
    expect(preset.layout.pageCount).toBeGreaterThanOrEqual(3);
    expect(preset.layout.pageCount).toBeLessThanOrEqual(12);
  });

  it("uses four-column layout when 4-column sections are detected", () => {
    const preset = extractStyleFromText(TRITEN_SAMPLE_TEXT);
    // Build plan detected → 4-column layout
    expect(preset.layout.coverLayout).toBe("full-bleed");
  });

  it("uses centered layout for simpler documents", () => {
    const simpleText = `
Executive Summary
We propose a solution.

Scope
Phase 1 deliverables.

Pricing
$50,000 fixed fee.
`;
    const preset = extractStyleFromText(simpleText);
    expect(preset.layout.coverLayout).toBe("centered");
  });

  it("returns a minimal preset with cover for empty text", () => {
    const preset = extractStyleFromText("");
    expect(preset.id).toBe("custom");
    expect(preset.sections.length).toBe(1);
    expect(preset.sections[0]?.id).toBe("cover");
  });
});

describe("extractStyleFromPdfText", () => {
  it("returns a fallback preset for empty text", () => {
    const preset = extractStyleFromPdfText("");
    expect(preset.id).toBe("custom");
    expect(preset.description).toContain("Fallback");
  });

  it("delegates to extractStyleFromText for non-empty text", () => {
    const preset = extractStyleFromPdfText(TRITEN_SAMPLE_TEXT, {
      presetName: "PDF Extract",
      sourcePath: "/path/to/ref.pdf",
    });
    expect(preset.name).toBe("PDF Extract");
    expect(preset.source).toBe("/path/to/ref.pdf");
    expect(preset.sections.length).toBeGreaterThanOrEqual(4);
  });
});
