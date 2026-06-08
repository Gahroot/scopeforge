import { describe, expect, it } from "vitest";
import {
  createProposalDraftCandidate,
  extractSourceMaterialFromFile,
  extractSourceMaterialFromText,
} from "./index.js";

const meetingNotes = [
  "Client: Acme Operations",
  "Buyer: Riley Chen, COO",
  "Headcount: 45 people",
  "Systems: Power BI, Monday",
  "Goal: automate investor reporting handoffs",
  "Pain points: manual reconciliation and spreadsheet sprawl",
  "Scope: reporting data layer; governed dashboard",
  "7 analysts spend 3 hours per week on manual reporting at $85/hr",
  "Workflow savings: reporting cycle value $20k-$30k annually",
  "Budget: $40k pilot",
].join("\n");

describe("source-material ingestion", () => {
  it("extracts pasted notes into a candidate while keeping economics missing", () => {
    const extracted = extractSourceMaterialFromText({
      text: meetingNotes,
      sourceKind: "meeting_notes",
      sourceName: "Fathom summary",
    });
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const candidate = createProposalDraftCandidate(extracted.document);

    expect(candidate.facts.companyName).toBe("Acme Operations");
    expect(candidate.facts.buyerTitle).toBe("COO");
    expect(candidate.facts.systems).toEqual(expect.arrayContaining(["Monday", "Power BI"]));
    expect(candidate.draftPatch.projectHints.workstreams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.stringContaining("Power BI") }),
      ]),
    );
    expect(candidate.draftPatch.projectHints.observedPricing[0]?.price).toBe(40000);
    expect(candidate.missingInputs.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "project.cost.workstreams.estimates",
        "project.cost.blendedRateMargin",
        "project.value.realizationFactor",
        "project.pricing.confirmation",
      ]),
    );
  });

  it("turns uploaded JSON into useful source text and candidate facts", () => {
    const bytes = Buffer.from(
      JSON.stringify({
        client: { company: "JsonCo", buyer: "COO", headcount: 18 },
        meeting: { summary: "Manual Excel reporting in Power BI needs automation." },
        scope: { items: ["reporting workflow automation"] },
      }),
    );

    const extracted = extractSourceMaterialFromFile({
      bytes,
      fileName: "summary.json",
      mediaType: "application/json",
    });

    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const candidate = createProposalDraftCandidate(extracted.document);
    expect(extracted.document.metadata.kind).toBe("json");
    expect(extracted.document.text).toContain("Manual Excel reporting");
    expect(candidate.facts.companyName).toBe("JsonCo");
    expect(candidate.facts.buyerTitle).toBe("COO");
    expect(candidate.facts.headcount).toBe(18);
    expect(candidate.draftPatch.projectHints.workstreams).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Reporting workflow automation" })]),
    );
  });

  it("extracts selectable text from simple PDFs and rejects oversize uploads", () => {
    const pdf = Buffer.from(
      [
        "%PDF-1.4",
        "1 0 obj",
        "<< /Length 74 >>",
        "stream",
        "BT",
        "(Client: PDF Co) Tj",
        "[(Manual reporting in ) 120 (Power BI)] TJ",
        "ET",
        "endstream",
        "endobj",
        "%%EOF",
      ].join("\n"),
      "latin1",
    );

    const extracted = extractSourceMaterialFromFile({
      bytes: pdf,
      fileName: "notes.pdf",
      mediaType: "application/pdf",
    });
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.document.text).toContain("Client: PDF Co");
    expect(extracted.document.text).toContain("Power BI");

    const tooLarge = extractSourceMaterialFromFile({
      bytes: Buffer.alloc(6),
      fileName: "large.txt",
      mediaType: "text/plain",
      maxBytes: 5,
    });
    expect(tooLarge.ok).toBe(false);
    if (tooLarge.ok) return;
    expect(tooLarge.error.code).toBe("source_material_too_large");
  });
});
