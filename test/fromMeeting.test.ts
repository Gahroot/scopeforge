import { describe, expect, it } from "vitest";

import {
  draftProjectFromSummary,
  type ExtractedFields,
  heuristicExtract,
  type MeetingExtractor,
} from "../src/ingest/fromMeeting.js";

const SAMPLE_SUMMARY = `
Client: Triten Real Estate Partners
Meeting with Brent, their COO.

They run a team of 45 people across four groups: 7 analysts, 6 asset managers,
5 internal finance staff, and 4 principals.

Today everything lives in Yardi and Power BI, with project tracking in Monday.
The analysts spend hours manually copy-pasting numbers into spreadsheets every
week, reconciliation is painful, and leadership has no reporting visibility.
`;

describe("draftProjectFromSummary", () => {
  it("fills meeting-extractable fields from a Fathom-style summary", () => {
    // Arrange
    const summary = SAMPLE_SUMMARY;

    // Act
    const draft = draftProjectFromSummary(summary);

    // Assert — identity + size
    expect(draft.project).toBe("Triten Real Estate Partners");
    expect(draft.client?.buyerRole).toBe("COO");
    expect(draft.client?.sizeHeadcount).toBe(45);
    expect(draft.client?.workingWeeks).toBe(46);

    // Assert — role segments (names + headcount captured)
    expect(draft.value?.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "analysts", headcount: 7 }),
        expect.objectContaining({ role: "asset managers", headcount: 6 }),
      ]),
    );

    // Assert — systems become workstream names + phase deliverables
    const workstreamNames = draft.cost?.workstreams.map((w) => w.name) ?? [];
    expect(workstreamNames).toEqual(
      expect.arrayContaining(["Yardi integration", "Power BI integration", "Monday integration"]),
    );
    expect(draft.pricing?.phases?.[0]?.deliverables).toEqual(
      expect.arrayContaining(["Yardi integration", "Power BI integration"]),
    );

    // Assert — pain points become workflow labels
    const workflowNames = draft.value?.workflows.map((w) => w.name) ?? [];
    expect(workflowNames).toEqual(expect.arrayContaining(["Manual data entry", "Reconciliation"]));
  });

  it("leaves cost-lens judgment fields absent (never invented)", () => {
    // Arrange
    const summary = SAMPLE_SUMMARY;

    // Act
    const draft = draftProjectFromSummary(summary);

    // Assert — cost judgment scalars never invented
    expect(draft.cost?.blendedRate).toBeUndefined();
    expect(draft.cost?.margin).toBeUndefined();

    // Assert — per-workstream cost judgment never invented
    for (const workstream of draft.cost?.workstreams ?? []) {
      expect(workstream).not.toHaveProperty("hours");
      expect(workstream).not.toHaveProperty("aiFactor");
      expect(workstream).not.toHaveProperty("judgment");
    }

    // Assert — value/pricing judgment scalars never invented
    expect(draft.value?.realizationFactor).toBeUndefined();
    expect(draft.pricing?.valueFraction).toBeUndefined();

    // Assert — extractable-but-human numbers are explicit TODO placeholders, not guesses
    for (const segment of draft.value?.segments ?? []) {
      expect(segment.hoursPerWeek).toBe(0);
      expect(segment.loadedRate).toBe(0);
    }
    for (const workflow of draft.value?.workflows ?? []) {
      expect(workflow.low).toBe(0);
      expect(workflow.high).toBe(0);
    }

    // Open pricing phase is intentionally unpriced
    expect(draft.pricing?.phases?.[0]?.price).toBeNull();
    expect(draft.pricing?.phases?.[0]?.status).toBe("open");
  });

  it("uses the injected extractor (pure mapping, no LLM call)", () => {
    // Arrange — a stub extractor proves the mapping is deterministic in isolation
    const stub: MeetingExtractor = (): ExtractedFields => ({
      projectName: "Acme",
      buyerRole: "CFO",
      headcount: 12,
      segments: [{ role: "operators", headcount: 3 }],
      systems: ["NetSuite"],
      painPoints: ["Manual data entry"],
    });

    // Act
    const draft = draftProjectFromSummary("ignored input", { extract: stub });

    // Assert
    expect(draft.project).toBe("Acme");
    expect(draft.client?.buyerRole).toBe("CFO");
    expect(draft.cost?.workstreams.map((w) => w.name)).toEqual(["NetSuite integration"]);
    expect(draft.value?.segments[0]).toMatchObject({ role: "operators", headcount: 3 });
  });

  it("heuristicExtract is deterministic for the same input", () => {
    // Arrange / Act
    const a = heuristicExtract(SAMPLE_SUMMARY);
    const b = heuristicExtract(SAMPLE_SUMMARY);

    // Assert
    expect(a).toEqual(b);
    expect(a.systems).toContain("Yardi");
    expect(a.painPoints.length).toBeGreaterThan(0);
  });
});
