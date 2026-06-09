import { z } from "zod";
import { stream } from "@kenkaiiii/gg-ai";
import type { EnabledAgentConfig } from "../agent/config.node.js";
import { MAX_SOURCE_MATERIAL_IMAGE_FILE_BYTES } from "./limits.js";
import type {
  SourceMaterialError,
  SourceMaterialExtractionResult,
  SourceMaterialFacts,
  SourceMaterialMetadata,
} from "./types.js";

const VISION_PROMPT = `You are analyzing an image that may contain a whiteboard photo, architecture diagram, wireframe screenshot, or other visual artifact related to a software/build project.

Extract the following information as a JSON object. Use null for any field you cannot determine from the image. Be precise and conservative — only extract what you can clearly see.

{
  "projectName": "string or null — project/initiative name if visible",
  "companyName": "string or null — company/client name if visible",
  "systems": ["array of system/tool/component names visible in the image"],
  "painPoints": ["array of pain points, bottlenecks, or problems depicted or labeled"],
  "goals": ["array of goals, objectives, or outcomes depicted"],
  "scopeItems": ["array of workstreams, features, or scope items visible"],
  "deliverables": ["array of deliverables, outputs, or artifacts shown"],
  "roleSegments": [
    {
      "role": "role/title name",
      "headcount": number or null,
      "hoursPerWeek": number or null,
      "loadedRate": number or null,
      "evidence": "brief quote or description from the image"
    }
  ],
  "workflowValues": [
    {
      "name": "workflow or process name",
      "low": number or null,
      "high": number or null,
      "evidence": "brief description from the image"
    }
  ],
  "observedPricing": [
    {
      "label": "pricing label",
      "price": number or null,
      "evidence": "brief description from the image"
    }
  ],
  "assumptions": ["array of assumptions visible in the image"],
  "constraints": ["array of constraints, risks, or limitations shown"],
  "nextSteps": ["array of next steps or action items if visible"]
}

Return ONLY the JSON object. No markdown, no explanation.`;

const visionResponseSchema = z.object({
  projectName: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  systems: z.array(z.string()).optional(),
  painPoints: z.array(z.string()).optional(),
  goals: z.array(z.string()).optional(),
  scopeItems: z.array(z.string()).optional(),
  deliverables: z.array(z.string()).optional(),
  roleSegments: z
    .array(
      z.object({
        role: z.string(),
        headcount: z.number().nullable().optional(),
        hoursPerWeek: z.number().nullable().optional(),
        loadedRate: z.number().nullable().optional(),
        evidence: z.string(),
      }),
    )
    .optional(),
  workflowValues: z
    .array(
      z.object({
        name: z.string(),
        low: z.number().nullable().optional(),
        high: z.number().nullable().optional(),
        evidence: z.string(),
      }),
    )
    .optional(),
  observedPricing: z
    .array(
      z.object({
        label: z.string(),
        price: z.number().nullable().optional(),
        evidence: z.string(),
      }),
    )
    .optional(),
  assumptions: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
});

type VisionResponse = z.infer<typeof visionResponseSchema>;

const SUPPORTED_VISION_PROVIDERS = new Set(["anthropic", "openai"]);

function isVisionSupportedProvider(
  provider: string,
): provider is "anthropic" | "openai" {
  return SUPPORTED_VISION_PROVIDERS.has(provider);
}

function extractTextFromAssistantContent(
  content: string | readonly { type: string; text?: string }[],
): string {
  if (typeof content === "string") return content;
  const textParts: string[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
    }
  }
  return textParts.join("");
}

function stripCodeFences(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("```")) {
    const withoutOpening = trimmed.replace(/^```(?:json)?\s*\n?/, "");
    const withoutClosing = withoutOpening.replace(/\n?```\s*$/, "");
    return withoutClosing.trim();
  }
  return trimmed;
}

export async function extractFromImage(
  bytes: Uint8Array,
  mediaType: string,
  agentConfig: EnabledAgentConfig,
): Promise<SourceMaterialExtractionResult> {
  if (bytes.byteLength === 0) {
    return extractionFailure({
      code: "source_material_empty",
      message: "Image file is empty.",
    });
  }

  if (bytes.byteLength > MAX_SOURCE_MATERIAL_IMAGE_FILE_BYTES) {
    return extractionFailure({
      code: "source_material_too_large",
      message: `Image files must be ${MAX_SOURCE_MATERIAL_IMAGE_FILE_BYTES} bytes or smaller.`,
      details: [`receivedBytes: ${bytes.byteLength}`],
    });
  }

  if (!isVisionSupportedProvider(agentConfig.provider)) {
    return extractionFailure({
      code: "source_material_image_no_provider",
      message: `Image extraction requires an OpenAI or Anthropic provider. Current provider: ${agentConfig.provider}.`,
      details: [
        "Set SCOPEFORGE_AGENT_PROVIDER to 'openai' or 'anthropic' for image support.",
      ],
    });
  }

  const base64Data = Buffer.from(bytes).toString("base64");

  try {
    const response = await stream({
      provider: agentConfig.provider,
      model: agentConfig.model,
      apiKey: agentConfig.apiKey,
      ...(agentConfig.baseUrl === undefined ? {} : { baseUrl: agentConfig.baseUrl }),
      maxTokens: 4096,
      temperature: 0.1,
      supportsImages: true,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              mediaType,
              data: base64Data,
            },
            {
              type: "text",
              text: VISION_PROMPT,
            },
          ],
        },
      ],
    });

    const responseText = extractTextFromAssistantContent(
      response.message.content,
    );

    if (responseText.trim().length === 0) {
      return extractionFailure({
        code: "source_material_image_unreadable",
        message:
          "The AI model did not return extractable content from this image. Try a clearer image.",
      });
    }

    const parsed = parseVisionResponse(responseText);
    if (!parsed.ok) return extractionFailure(parsed.error);

    const facts = visionResponseToFacts(parsed.value);
    const textDescription = summarizeVisionFacts(facts);

    return extractionSuccess({
      text: textDescription,
      warnings: [],
      metadata: {
        origin: "upload",
        kind: "image",
        sourceName: "AI-extracted from image",
        mediaType,
        byteLength: bytes.byteLength,
        characterLength: textDescription.length,
        truncated: false,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    if (
      message.includes("ECONNREFUSED") ||
      message.includes("fetch") ||
      message.includes("network")
    ) {
      return extractionFailure({
        code: "source_material_image_no_provider",
        message:
          "Could not connect to the AI provider for image extraction. Check your API key and network connection.",
        details: [message],
      });
    }
    return extractionFailure({
      code: "source_material_image_unreadable",
      message: `Image extraction failed: ${message}`,
    });
  }
}

function parseVisionResponse(
  rawText: string,
):
  | { readonly ok: true; readonly value: VisionResponse }
  | { readonly ok: false; readonly error: SourceMaterialError } {
  const cleaned = stripCodeFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    return {
      ok: false,
      error: {
        code: "source_material_image_unreadable",
        message:
          "The AI response could not be parsed as JSON. The image may not contain recognizable project information.",
        details: [rawText.slice(0, 200)],
      },
    };
  }

  const result = visionResponseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: "source_material_image_unreadable",
        message:
          "The AI response did not match the expected structure. The image may not contain recognizable project information.",
        details: result.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        ),
      },
    };
  }

  return { ok: true, value: result.data };
}

function visionResponseToFacts(response: VisionResponse): SourceMaterialFacts {
  return {
    ...(response.projectName != null && response.projectName.length > 0
      ? { projectName: response.projectName }
      : {}),
    ...(response.companyName != null && response.companyName.length > 0
      ? { companyName: response.companyName }
      : {}),
    systems: response.systems ?? [],
    painPoints: response.painPoints ?? [],
    goals: response.goals ?? [],
    scopeItems: response.scopeItems ?? [],
    deliverables: response.deliverables ?? [],
    roleSegments: (response.roleSegments ?? []).map((segment) => ({
      role: segment.role,
      ...(segment.headcount != null ? { headcount: segment.headcount } : {}),
      ...(segment.hoursPerWeek != null
        ? { hoursPerWeek: segment.hoursPerWeek }
        : {}),
      ...(segment.loadedRate != null
        ? { loadedRate: segment.loadedRate }
        : {}),
      evidence: segment.evidence,
    })),
    workflowValues: (response.workflowValues ?? []).map((workflow) => ({
      name: workflow.name,
      ...(workflow.low != null ? { low: workflow.low } : {}),
      ...(workflow.high != null ? { high: workflow.high } : {}),
      evidence: workflow.evidence,
    })),
    observedPricing: (response.observedPricing ?? []).map((pricing) => ({
      label: pricing.label,
      ...(pricing.price != null ? { price: pricing.price } : {}),
      evidence: pricing.evidence,
    })),
    assumptions: response.assumptions ?? [],
    constraints: response.constraints ?? [],
    nextSteps: response.nextSteps ?? [],
  };
}

function summarizeVisionFacts(facts: SourceMaterialFacts): string {
  const pieces: string[] = [];

  if (facts.projectName !== undefined) {
    pieces.push(`Project: ${facts.projectName}.`);
  }
  if (facts.companyName !== undefined) {
    pieces.push(`Company: ${facts.companyName}.`);
  }
  if (facts.systems.length > 0) {
    pieces.push(`Systems identified: ${facts.systems.join(", ")}.`);
  }
  if (facts.scopeItems.length > 0) {
    pieces.push(`Scope items: ${facts.scopeItems.join("; ")}.`);
  }
  if (facts.deliverables.length > 0) {
    pieces.push(`Deliverables: ${facts.deliverables.join("; ")}.`);
  }
  if (facts.goals.length > 0) {
    pieces.push(`Goals: ${facts.goals.join("; ")}.`);
  }
  if (facts.painPoints.length > 0) {
    pieces.push(`Pain points: ${facts.painPoints.join("; ")}.`);
  }
  if (facts.roleSegments.length > 0) {
    pieces.push(
      `Roles: ${facts.roleSegments.map((s) => s.headcount !== undefined ? `${s.headcount} ${s.role}` : s.role).join(", ")}.`,
    );
  }
  if (facts.workflowValues.length > 0) {
    pieces.push(
      `Workflow values: ${facts.workflowValues.map((w) => `${w.name} ($${w.low ?? "?"}-$${w.high ?? "?"})`).join(", ")}.`,
    );
  }
  if (facts.observedPricing.length > 0) {
    pieces.push(
      `Observed pricing: ${facts.observedPricing.map((p) => `${p.label}: $${p.price ?? "?"}`).join(", ")}.`,
    );
  }
  if (facts.assumptions.length > 0) {
    pieces.push(`Assumptions: ${facts.assumptions.join("; ")}.`);
  }
  if (facts.constraints.length > 0) {
    pieces.push(`Constraints: ${facts.constraints.join("; ")}.`);
  }
  if (facts.nextSteps.length > 0) {
    pieces.push(`Next steps: ${facts.nextSteps.join("; ")}.`);
  }

  if (pieces.length === 0) {
    return "Image was processed but no structured project information could be extracted.";
  }

  return pieces.join(" ");
}

function extractionSuccess(input: {
  readonly text: string;
  readonly warnings: readonly string[];
  readonly metadata: SourceMaterialMetadata;
}): SourceMaterialExtractionResult {
  return {
    ok: true,
    document: {
      metadata: input.metadata,
      text: input.text,
      warnings: input.warnings,
    },
  };
}

function extractionFailure(error: SourceMaterialError): SourceMaterialExtractionResult {
  return { ok: false, error };
}
