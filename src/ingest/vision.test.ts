import { describe, expect, it, vi, beforeEach } from "vitest";
import type { EnabledAgentConfig } from "../agent/config.node.js";

vi.mock("@kenkaiiii/gg-ai", () => ({
  stream: vi.fn(),
}));

const anthropicConfig: EnabledAgentConfig = {
  enabled: true,
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  apiKey: "test-key",
  apiKeyEnvVar: "TEST_API_KEY",
};

const openaiConfig: EnabledAgentConfig = {
  enabled: true,
  provider: "openai",
  model: "gpt-4.1",
  apiKey: "test-key",
  apiKeyEnvVar: "TEST_API_KEY",
};

const disabledConfig = {
  enabled: false,
  reason: "not_configured" as const,
} as unknown as EnabledAgentConfig;

function createFakeImageBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
}

async function importVision(): Promise<typeof import("./vision.node.js")> {
  return import("./vision.node.js");
}

describe("vision extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts structured facts from a whiteboard image", async () => {
    const visionData = {
      projectName: "Data Pipeline Modernization",
      companyName: "Acme Corp",
      systems: ["Snowflake", "dbt", "Airflow"],
      painPoints: ["Manual ETL processes", "Data quality issues"],
      goals: ["Automate data pipelines", "Improve data freshness"],
      scopeItems: [
        "Snowflake migration",
        "dbt model development",
        "Airflow orchestration",
      ],
      deliverables: ["Production data pipeline", "Monitoring dashboard"],
      roleSegments: [
        {
          role: "Data Engineer",
          headcount: 3,
          hoursPerWeek: 40,
          loadedRate: 125,
          evidence: "3 data engineers labeled on the diagram",
        },
      ],
      workflowValues: [
        {
          name: "ETL automation savings",
          low: 50000,
          high: 80000,
          evidence: "Savings range written on whiteboard",
        },
      ],
      observedPricing: [],
      assumptions: ["Current Snowflake license in place"],
      constraints: ["Must maintain existing SLAs"],
      nextSteps: ["Architecture review meeting"],
    };

    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockResolvedValue({
      message: { role: "assistant", content: JSON.stringify(visionData) },
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 200 },
    });

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.metadata.kind).toBe("image");
    expect(result.document.metadata.mediaType).toBe("image/png");
    expect(result.document.text).toContain("Data Pipeline Modernization");
    expect(result.document.text).toContain("Acme Corp");
    expect(result.document.text).toContain("Snowflake");
    expect(result.document.warnings).toEqual([]);
  });

  it("returns a helpful error when no AI provider is configured", async () => {
    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      disabledConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_material_image_no_provider");
    expect(result.error.message).toContain("OpenAI or Anthropic");
  });

  it("returns an error for unsupported provider", async () => {
    const geminiConfig: EnabledAgentConfig = {
      enabled: true,
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "test-key",
      apiKeyEnvVar: "TEST_API_KEY",
    };

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      geminiConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_material_image_no_provider");
    expect(result.error.message).toContain("OpenAI or Anthropic");
  });

  it("returns an error for empty image bytes", async () => {
    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      new Uint8Array(0),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_material_empty");
  });

  it("returns an error for oversized images", async () => {
    const oversizedBytes = new Uint8Array(11_000_000);
    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      oversizedBytes,
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_material_too_large");
  });

  it("handles network errors gracefully", async () => {
    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockRejectedValue(
      new Error("ECONNREFUSED: Connection refused"),
    );

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_material_image_no_provider");
    expect(result.error.message).toContain("connect");
  });

  it("handles API errors gracefully", async () => {
    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockRejectedValue(
      new Error("Rate limit exceeded: too many requests"),
    );

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      openaiConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_material_image_unreadable");
    expect(result.error.message).toContain("Image extraction failed");
  });

  it("handles empty AI response gracefully", async () => {
    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockResolvedValue({
      message: { role: "assistant", content: "" },
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 0 },
    });

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_material_image_unreadable");
    expect(result.error.message).toContain("not return extractable content");
  });

  it("handles non-JSON AI response gracefully", async () => {
    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockResolvedValue({
      message: {
        role: "assistant",
        content:
          "I cannot identify any project information in this image.",
      },
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("source_material_image_unreadable");
  });

  it("strips markdown code fences from AI response", async () => {
    const visionData = {
      projectName: "Test Project",
      companyName: "TestCo",
      systems: [],
      painPoints: [],
      goals: ["Build a thing"],
      scopeItems: [],
      deliverables: [],
      roleSegments: [],
      workflowValues: [],
      observedPricing: [],
      assumptions: [],
      constraints: [],
      nextSteps: [],
    };

    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockResolvedValue({
      message: {
        role: "assistant",
        content: `\`\`\`json\n${JSON.stringify(visionData)}\n\`\`\``,
      },
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 200 },
    });

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.text).toContain("Test Project");
    expect(result.document.text).toContain("TestCo");
  });

  it("parses response with content as array of parts", async () => {
    const visionData = {
      projectName: "Diagram Project",
      companyName: null,
      systems: ["Kubernetes"],
      painPoints: [],
      goals: [],
      scopeItems: ["Container orchestration"],
      deliverables: [],
      roleSegments: [],
      workflowValues: [],
      observedPricing: [],
      assumptions: [],
      constraints: [],
      nextSteps: [],
    };

    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockResolvedValue({
      message: {
        role: "assistant",
        content: [
          { type: "thinking", text: "Let me analyze this diagram..." },
          { type: "text", text: JSON.stringify(visionData) },
        ],
      },
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 200 },
    });

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.text).toContain("Diagram Project");
    expect(result.document.text).toContain("Kubernetes");
  });
});

describe("vision facts mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts all fact categories from vision response", async () => {
    const visionData = {
      projectName: "Full Extraction Test",
      companyName: "FullCo",
      systems: ["Salesforce", "HubSpot"],
      painPoints: ["Manual data entry", "Duplicated effort"],
      goals: ["Automate CRM sync"],
      scopeItems: ["Salesforce integration", "HubSpot connector"],
      deliverables: ["Bidirectional sync pipeline"],
      roleSegments: [
        {
          role: "Sales Ops Manager",
          headcount: 2,
          hoursPerWeek: 10,
          loadedRate: 95,
          evidence: "2 managers handling data entry",
        },
        {
          role: "SDR",
          headcount: 5,
          hoursPerWeek: 5,
          loadedRate: 75,
          evidence: "5 SDRs re-keying contact data",
        },
      ],
      workflowValues: [
        {
          name: "Data entry time savings",
          low: 30000,
          high: 60000,
          evidence: "Annual savings estimate",
        },
      ],
      observedPricing: [
        {
          label: "Implementation budget",
          price: 85000,
          evidence: "Budget noted in meeting",
        },
      ],
      assumptions: ["Both CRM licenses active"],
      constraints: ["Go-live by Q3"],
      nextSteps: ["Technical discovery workshop"],
    };

    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockResolvedValue({
      message: { role: "assistant", content: JSON.stringify(visionData) },
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 200 },
    });

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const text = result.document.text;
    expect(text).toContain("Full Extraction Test");
    expect(text).toContain("FullCo");
    expect(text).toContain("Salesforce");
    expect(text).toContain("HubSpot");
    expect(text).toContain("Automate CRM sync");
    expect(text).toContain("Manual data entry");
    expect(text).toContain("Salesforce integration");
    expect(text).toContain("Bidirectional sync pipeline");
    expect(text).toContain("2 Sales Ops Manager");
    expect(text).toContain("5 SDR");
    expect(text).toContain("$30000");
    expect(text).toContain("$60000");
    expect(text).toContain("$85000");
    expect(text).toContain("Both CRM licenses active");
    expect(text).toContain("Go-live by Q3");
    expect(text).toContain("Technical discovery workshop");
  });

  it("returns minimal summary when all fields are empty", async () => {
    const visionData = {
      projectName: null,
      companyName: null,
      systems: [],
      painPoints: [],
      goals: [],
      scopeItems: [],
      deliverables: [],
      roleSegments: [],
      workflowValues: [],
      observedPricing: [],
      assumptions: [],
      constraints: [],
      nextSteps: [],
    };

    const { stream } = await import("@kenkaiiii/gg-ai");
    vi.mocked(stream).mockResolvedValue({
      message: { role: "assistant", content: JSON.stringify(visionData) },
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 200 },
    });

    const { extractFromImage } = await importVision();
    const result = await extractFromImage(
      createFakeImageBytes(),
      "image/png",
      anthropicConfig,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.text).toContain(
      "Image was processed but no structured project information could be extracted.",
    );
  });
});
