import { tritenExample } from "../data/defaults.js";
import { proposalIntakeToDraft } from "../proposal/draftStore.js";
import type { ProposalIntake } from "../proposal/types.js";
import { handleApiRoute, type ApiRouteResponse } from "./routes.js";

const sampleIntake = {
  project: tritenExample(),
  preparedFor: {
    companyName: "Acme Operations",
    buyerName: "Riley Chen",
    buyerTitle: "COO",
    logoText: "AO",
    accentColor: "#2563eb",
  },
  details: {
    title: "Operations AI Pilot",
    subtitle: "A scoped build for faster reporting",
    date: "2026-06-05",
    recommendation: "Start with a focused pilot that proves weekly operating leverage.",
    executiveSummary: [
      "Acme needs a trusted operating layer before broader workflow automation.",
      "The pilot keeps scope narrow enough to validate payback without hiding delivery risk.",
    ],
    whatWeHeard: [
      "Reporting still depends on manual reconciliation.",
      "Leadership wants client-safe visibility into the first automation milestone.",
    ],
  },
  scope: [
    {
      title: "Reporting foundation",
      description: "Build the core data and workflow layer for the pilot.",
      deliverables: ["Data model", "Pilot dashboard", "Handoff notes"],
      outcomes: ["Reduced weekly reporting drag"],
    },
  ],
  milestones: [
    {
      name: "Pilot build",
      timing: "Weeks 1-4",
      outcomes: ["Validated data model", "Working preview"],
    },
  ],
  assumptions: ["Acme provides source-system access."],
  exclusions: ["Production integrations outside the pilot are scoped later."],
  clientInputs: ["One business owner for acceptance review."],
  nextSteps: ["Confirm source access", "Schedule kickoff"],
} satisfies ProposalIntake;

describe("server API routes", () => {
  it("reports health and server-owned capabilities", async () => {
    const response = await handleApiRoute({ method: "GET", pathname: "/api/health" });
    const json = expectJson(response);

    expect(json.status).toBe(200);
    expect(json.body).toEqual(
      expect.objectContaining({
        ok: true,
        service: "scopeforge-app-server",
      }),
    );
  });

  it("returns proposal validation errors", async () => {
    const response = await handleApiRoute({
      method: "POST",
      pathname: "/api/proposals/validate",
      body: {},
    });
    const json = expectJson(response);

    expect(json.status).toBe(422);
    expect(json.body).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "validation_failed" }),
      }),
    );
  });

  it("analyzes a project deterministically with request options", async () => {
    const response = await handleApiRoute({
      method: "POST",
      pathname: "/api/proposals/analyze",
      body: { project: sampleIntake.project, seed: 11, iterations: 500 },
    });
    const json = expectJson(response);
    const analysis = readRecordField(json.body, "analysis");
    const cost = readRecordField(analysis, "cost");
    const floor = readRecordField(cost, "priceFloor");

    expect(json.status).toBe(200);
    expect(readNumberField(floor, "p50")).toBeGreaterThan(0);
  });

  it("analyzes draft pricing phases as the source of truth", async () => {
    const draft = proposalIntakeToDraft(sampleIntake);
    const firstPhase = draft.pricing.phases[0];
    const secondPhase = draft.pricing.phases[1];
    if (firstPhase === undefined || secondPhase === undefined) {
      throw new Error("Sample draft must include two pricing phases.");
    }
    const repricedDraft = {
      ...draft,
      pricing: {
        ...draft.pricing,
        phases: [
          { ...firstPhase, price: null },
          { ...secondPhase, price: 150_000 },
        ],
      },
    };

    const response = await handleApiRoute({
      method: "POST",
      pathname: "/api/proposals/analyze",
      body: { draft: repricedDraft, iterations: 500 },
    });
    const json = expectJson(response);
    const analysis = readRecordField(json.body, "analysis");
    const pricing = readRecordField(analysis, "pricing");

    expect(json.status).toBe(200);
    expect(readNumberField(pricing, "paybackMonths")).toBeGreaterThan(12);
  });

  it("renders client-safe proposal HTML", async () => {
    const response = await handleApiRoute({
      method: "POST",
      pathname: "/api/proposals/preview",
      body: { intake: sampleIntake, brand: "partners", audience: "client", iterations: 500 },
    });
    const json = expectJson(response);
    const html = readStringField(json.body, "html");

    expect(json.status).toBe(200);
    expect(html).toContain("Acme Operations");
    expect(html).toContain("Operations AI Pilot");
    expect(html).not.toContain("Internal appendix");
  });

  it("exports rendered HTML through an injected PDF renderer", async () => {
    let renderedHtml = "";
    const pdfBytes = Buffer.from("%PDF-scopeforge-test");

    const response = await handleApiRoute(
      {
        method: "POST",
        pathname: "/api/proposals/export-pdf",
        body: {
          intake: sampleIntake,
          templateId: "generic/value-proposal",
          brand: "nolan",
          audience: "client",
          iterations: 500,
          fileName: "../Acme Proposal.pdf",
        },
      },
      {
        renderPdf: async (request) => {
          renderedHtml = request.html;
          return { bytes: pdfBytes, format: request.format };
        },
      },
    );
    const binary = expectBinary(response);

    expect(binary.status).toBe(200);
    expect(binary.body).toEqual(pdfBytes);
    expect(binary.headers["Content-Type"]).toBe("application/pdf");
    expect(binary.headers["Content-Disposition"]).toBe('attachment; filename="Acme Proposal.pdf"');
    expect(renderedHtml).toContain("Acme Operations");
  });

  it("validates draft template selections before PDF export", async () => {
    const draft = proposalIntakeToDraft(sampleIntake);

    const response = await handleApiRoute({
      method: "POST",
      pathname: "/api/proposals/export-pdf",
      body: {
        draft,
        templateId: "generic/scope-review",
        brand: "nolan",
        audience: "client",
        iterations: 500,
      },
    });
    const json = expectJson(response);

    expect(json.status).toBe(422);
    expect(json.body).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "template_mismatch" }),
      }),
    );
  });

  it("reports missing Chromium with the install command", async () => {
    const response = await handleApiRoute(
      {
        method: "POST",
        pathname: "/api/proposals/export-pdf",
        body: {
          intake: sampleIntake,
          brand: "nolan",
          audience: "client",
          iterations: 500,
        },
      },
      {
        renderPdf: async () => {
          throw new Error("Executable doesn't exist. Please run npx playwright install chromium");
        },
      },
    );
    const json = expectJson(response);

    expect(json.status).toBe(503);
    expect(json.body).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "chromium_missing",
          message: expect.stringContaining("npx playwright install chromium"),
        }),
      }),
    );
  });

  it("keeps future agent endpoints server-side and explicitly reserved", async () => {
    const response = await handleApiRoute({
      method: "POST",
      pathname: "/api/agent/messages",
      body: { message: "draft this" },
    });
    const json = expectJson(response);

    expect(json.status).toBe(501);
    expect(json.body).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "agent_not_configured" }),
      }),
    );
  });
});

function expectJson(
  response: ApiRouteResponse | null,
): Extract<ApiRouteResponse, { kind: "json" }> {
  if (response === null || response.kind !== "json") {
    throw new Error("Expected a JSON route response.");
  }
  return response;
}

function expectBinary(
  response: ApiRouteResponse | null,
): Extract<ApiRouteResponse, { kind: "binary" }> {
  if (response === null || response.kind !== "binary") {
    throw new Error("Expected a binary route response.");
  }
  return response;
}

function readRecordField(input: unknown, key: string): Readonly<Record<string, unknown>> {
  if (!isRecord(input) || !isRecord(input[key])) {
    throw new Error(`Expected ${key} to be an object.`);
  }
  return input[key];
}

function readStringField(input: unknown, key: string): string {
  if (!isRecord(input) || typeof input[key] !== "string") {
    throw new Error(`Expected ${key} to be a string.`);
  }
  return input[key];
}

function readNumberField(input: unknown, key: string): number {
  if (!isRecord(input) || typeof input[key] !== "number") {
    throw new Error(`Expected ${key} to be a number.`);
  }
  return input[key];
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
