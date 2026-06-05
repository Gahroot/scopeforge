import { analyzeProject, type AnalyzeOptions, type Project } from "../core/index.js";
import { validateProject } from "../data/schema.js";
import { resolveBrand, validateProposalBrand } from "../proposal/brands.js";
import { proposalIntakeToDraft } from "../proposal/draftStore.js";
import { getClientBlockingWarnings } from "../proposal/model.js";
import {
  PROPOSAL_DRAFT_TEMPLATE_IDS,
  proposalDraftToIntake,
  validateProposalDraft,
  validateProposalIntake,
} from "../proposal/schema.js";
import type {
  ProposalAudience,
  ProposalBrand,
  ProposalDraft,
  ProposalDraftTemplateId,
  ProposalIntake,
  ProposalValidationError,
} from "../proposal/types.js";
import { isMissingChromiumError, renderProposalPdfBytes } from "../render/pdf.node.js";
import { renderValueProposalHtml } from "../render/valueProposalHtml.js";

const API_PREFIX = "/api";
const DEFAULT_BRAND_ID = "nolan";
const DEFAULT_PDF_FORMAT = "Letter";
const DEFAULT_TEMPLATE_ID = "generic/value-proposal" satisfies ProposalDraftTemplateId;
const MAX_ITERATIONS = 250_000;

export interface AppRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface JsonRouteResponse {
  readonly kind: "json";
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface BinaryRouteResponse {
  readonly kind: "binary";
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export type ApiRouteResponse = JsonRouteResponse | BinaryRouteResponse;

export interface ProposalPdfRenderRequest {
  readonly html: string;
  readonly format: string;
  readonly signal?: AbortSignal;
}

export interface ProposalPdfRenderResult {
  readonly bytes: Uint8Array;
  readonly format: string;
}

export type ProposalPdfRenderer = (
  request: ProposalPdfRenderRequest,
) => Promise<ProposalPdfRenderResult>;

export interface AppRouteDependencies {
  readonly renderPdf?: ProposalPdfRenderer;
}

interface ResolvedProposalDocument {
  readonly kind: "draft" | "intake";
  readonly draft: ProposalDraft;
  readonly intake: ProposalIntake;
  readonly project: Project;
  readonly templateId: ProposalDraftTemplateId;
}

interface ProposalRenderBundle {
  readonly proposal: ResolvedProposalDocument;
  readonly brand: ProposalBrand;
  readonly audience: ProposalAudience;
  readonly analysisOptions: AnalyzeOptions;
  readonly generatedAt?: Date;
  readonly html: string;
}

type RouteValueResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: ApiRouteResponse };

export async function handleApiRoute(
  request: AppRouteRequest,
  dependencies: AppRouteDependencies = {},
): Promise<ApiRouteResponse | null> {
  const pathname = canonicalPath(request.pathname);
  if (!pathname.startsWith(API_PREFIX)) return null;

  if (request.method === "OPTIONS") return noContentResponse();
  if (request.method === "GET" && pathname === "/api/health") return healthResponse();
  if (request.method === "GET" && pathname === "/api/brands") return brandsResponse();
  if (request.method === "POST" && pathname === "/api/brands/validate") {
    return validateBrandResponse(request.body);
  }
  if (request.method === "POST" && pathname === "/api/proposals/validate") {
    return validateProposalResponse(request.body);
  }
  if (request.method === "POST" && pathname === "/api/proposals/analyze") {
    return analyzeProposalResponse(request.body);
  }
  if (request.method === "POST" && pathname === "/api/proposals/preview") {
    return previewProposalResponse(request.body);
  }
  if (request.method === "POST" && pathname === "/api/proposals/export-pdf") {
    return exportProposalPdfResponse(request.body, request.signal, dependencies);
  }
  if (request.method === "POST" && pathname === "/api/agent/messages") {
    return reservedEndpointResponse(
      "agent_not_configured",
      "Agent/model calls are reserved for the local Node server and are not implemented yet.",
    );
  }
  if (request.method === "POST" && pathname === "/api/brand/from-website") {
    return reservedEndpointResponse(
      "brand_fetch_not_configured",
      "Website-derived brand extraction is reserved for server-side fetches and is not implemented yet.",
    );
  }

  return failureResponse(
    404,
    "not_found",
    `No API route is registered for ${request.method} ${pathname}.`,
  );
}

export async function renderPdfWithPlaywright(
  request: ProposalPdfRenderRequest,
): Promise<ProposalPdfRenderResult> {
  const pdf = await renderProposalPdfBytes({
    html: request.html,
    format: request.format,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  return { bytes: pdf.bytes, format: pdf.format };
}

function healthResponse(): ApiRouteResponse {
  return jsonResponse(200, {
    ok: true,
    service: "scopeforge-app-server",
    apiVersion: 1,
    capabilities: [
      "proposal.validate",
      "proposal.analyze",
      "proposal.previewHtml",
      "proposal.exportPdf",
      "brand.listBuiltIns",
      "brand.validate",
      "agent.reserved",
      "brand.fromWebsite.reserved",
    ],
  });
}

function brandsResponse(): ApiRouteResponse {
  return jsonResponse(200, {
    ok: true,
    brands: ["nolan", "partners"].map((brandId) => resolveBrand(brandId)),
  });
}

function validateBrandResponse(input: unknown): ApiRouteResponse {
  const candidate = unwrapNamedBody(input, "brand");
  const result = validateProposalBrand(candidate);
  if (!result.ok) {
    return validationFailureResponse("Brand profile is invalid.", result.errors);
  }

  return jsonResponse(200, { ok: true, brand: result.value });
}

function validateProposalResponse(input: unknown): ApiRouteResponse {
  const candidate = resolveProposalDocument(input);
  if (!candidate.ok) return candidate.response;

  return jsonResponse(200, {
    ok: true,
    kind: candidate.value.kind,
    templateId: candidate.value.templateId,
  });
}

function analyzeProposalResponse(input: unknown): ApiRouteResponse {
  const projectResult = resolveProjectInput(input);
  if (!projectResult.ok) return projectResult.response;

  const optionsResult = resolveAnalysisOptions(input);
  if (!optionsResult.ok) return optionsResult.response;

  const analysis = analyzeProject(projectResult.value, optionsResult.value);
  return jsonResponse(200, {
    ok: true,
    analysis,
    warnings: analysis.warnings,
  });
}

function previewProposalResponse(input: unknown): ApiRouteResponse {
  const bundle = buildProposalRenderBundle(input);
  if (!bundle.ok) return bundle.response;

  const analysis = analyzeProject(bundle.value.proposal.project, bundle.value.analysisOptions);
  const blockingWarnings = getClientBlockingWarnings(analysis, { audience: bundle.value.audience });
  if (blockingWarnings.length > 0) {
    return failureResponse(
      422,
      "guardrail_errors",
      "Guardrail errors block client proposal preview. Fix the economics or request internal audience.",
      blockingWarnings.map((warning) => `${warning.rule}: ${warning.message}`),
    );
  }

  return jsonResponse(200, {
    ok: true,
    kind: bundle.value.proposal.kind,
    templateId: bundle.value.proposal.templateId,
    audience: bundle.value.audience,
    brand: bundle.value.brand,
    analysis,
    warnings: analysis.warnings,
    html: bundle.value.html,
  });
}

async function exportProposalPdfResponse(
  input: unknown,
  signal: AbortSignal | undefined,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const bundle = buildProposalRenderBundle(input);
  if (!bundle.ok) return bundle.response;

  const analysis = analyzeProject(bundle.value.proposal.project, bundle.value.analysisOptions);
  const blockingWarnings = getClientBlockingWarnings(analysis, { audience: bundle.value.audience });
  if (blockingWarnings.length > 0) {
    return failureResponse(
      422,
      "guardrail_errors",
      "Guardrail errors block client PDF export. Fix the economics or request internal audience.",
      blockingWarnings.map((warning) => `${warning.rule}: ${warning.message}`),
    );
  }

  const format = readOptionalString(input, "format") ?? DEFAULT_PDF_FORMAT;
  const fileName = sanitizePdfFileName(
    readOptionalString(input, "fileName") ??
      `${bundle.value.proposal.intake.preparedFor.companyName}-proposal.pdf`,
  );
  const renderPdf = dependencies.renderPdf ?? renderPdfWithPlaywright;

  try {
    const pdf = await renderPdf({
      html: bundle.value.html,
      format,
      ...(signal === undefined ? {} : { signal }),
    });

    return {
      kind: "binary",
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(pdf.bytes.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
        "X-ScopeForge-Pdf-Format": pdf.format,
      },
      body: pdf.bytes,
    };
  } catch (error) {
    return pdfRenderFailureResponse(error);
  }
}

function buildProposalRenderBundle(input: unknown): RouteValueResult<ProposalRenderBundle> {
  const proposal = resolveProposalDocument(input);
  if (!proposal.ok) return proposal;

  const brandResult = resolveRequestBrand(input);
  if (!brandResult.ok) return brandResult;

  const audienceResult = resolveAudience(input);
  if (!audienceResult.ok) return audienceResult;

  const optionsResult = resolveAnalysisOptions(input);
  if (!optionsResult.ok) return optionsResult;

  const generatedAtResult = resolveGeneratedAt(input);
  if (!generatedAtResult.ok) return generatedAtResult;

  const html = renderValueProposalHtml(proposal.value.draft, {
    brand: brandResult.value,
    audience: audienceResult.value,
    ...(generatedAtResult.value === undefined ? {} : { generatedAt: generatedAtResult.value }),
  });

  return {
    ok: true,
    value: {
      proposal: proposal.value,
      brand: brandResult.value,
      audience: audienceResult.value,
      analysisOptions: optionsResult.value,
      ...(generatedAtResult.value === undefined ? {} : { generatedAt: generatedAtResult.value }),
      html,
    },
  };
}

function resolveProposalDocument(input: unknown): RouteValueResult<ResolvedProposalDocument> {
  const requestedTemplateId = resolveRequestedTemplateId(input);
  if (!requestedTemplateId.ok) return requestedTemplateId;

  const candidate = unwrapProposalCandidate(input);
  if (candidate.kind === "draft") {
    const result = validateProposalDraft(candidate.value);
    if (!result.ok) return validationFailureResult("Proposal draft is invalid.", result.errors);

    const templateId = requestedTemplateId.value ?? firstDraftTemplateId(result.value);
    if (!result.value.templateIds.some((id) => id === templateId)) {
      return routeFailure(
        failureResponse(
          422,
          "template_mismatch",
          "templateId must match one of the validated draft templateIds.",
          [
            `templateId: ${templateId}`,
            `draft.templateIds: ${result.value.templateIds.join(", ")}`,
          ],
        ),
      );
    }

    const intake = proposalDraftToIntake(result.value);
    return {
      ok: true,
      value: {
        kind: "draft",
        draft: result.value,
        intake,
        project: intake.project,
        templateId,
      },
    };
  }

  const result = validateProposalIntake(candidate.value);
  if (!result.ok) return validationFailureResult("Proposal intake is invalid.", result.errors);

  const templateId = requestedTemplateId.value ?? DEFAULT_TEMPLATE_ID;
  const draft = proposalIntakeToDraft(result.value, { templateId });
  return {
    ok: true,
    value: {
      kind: "intake",
      draft,
      intake: result.value,
      project: result.value.project,
      templateId,
    },
  };
}

function resolveProjectInput(input: unknown): RouteValueResult<Project> {
  if (
    looksLikeProposalEnvelope(input) ||
    looksLikeProposalDraft(input) ||
    looksLikeProposalIntake(input)
  ) {
    const proposal = resolveProposalDocument(input);
    if (!proposal.ok) return proposal;
    return { ok: true, value: proposal.value.project };
  }

  const candidate = unwrapProjectCandidate(input);
  const result = validateProject(candidate);
  if (!result.ok) return validationFailureResult("Project input is invalid.", result.errors);
  return { ok: true, value: result.value };
}

function unwrapProposalCandidate(input: unknown): {
  readonly kind: "draft" | "intake";
  readonly value: unknown;
} {
  if (isRecord(input)) {
    if (Object.hasOwn(input, "draft")) return { kind: "draft", value: input.draft };
    if (Object.hasOwn(input, "intake")) return { kind: "intake", value: input.intake };
  }

  if (looksLikeProposalDraft(input)) return { kind: "draft", value: input };
  return { kind: "intake", value: input };
}

function unwrapProjectCandidate(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const candidate = input.project;
  if (isRecord(candidate)) return candidate;
  return input;
}

function unwrapNamedBody(input: unknown, key: string): unknown {
  if (!isRecord(input)) return input;
  if (!Object.hasOwn(input, key)) return input;
  return input[key];
}

function resolveRequestBrand(input: unknown): RouteValueResult<ProposalBrand> {
  const rawBrand = readOptionalUnknown(input, "brand") ?? readOptionalUnknown(input, "brandId");
  if (rawBrand === undefined) return { ok: true, value: resolveBuiltInBrand(DEFAULT_BRAND_ID) };

  if (typeof rawBrand === "string") {
    const brand = resolveBrand(rawBrand);
    if (brand === null) {
      return routeFailure(
        failureResponse(
          400,
          "brand_unknown",
          "Brand must be a built-in id or a full brand profile.",
        ),
      );
    }
    return { ok: true, value: brand };
  }

  const result = validateProposalBrand(rawBrand);
  if (!result.ok) return validationFailureResult("Brand profile is invalid.", result.errors);
  return { ok: true, value: result.value };
}

function resolveBuiltInBrand(brandId: string): ProposalBrand {
  const brand = resolveBrand(brandId);
  if (brand === null) throw new Error(`Built-in brand was not registered: ${brandId}`);
  return brand;
}

function resolveRequestedTemplateId(
  input: unknown,
): RouteValueResult<ProposalDraftTemplateId | undefined> {
  const rawTemplateId =
    readOptionalUnknown(input, "templateId") ?? readOptionalUnknown(input, "template");
  if (rawTemplateId === undefined) return { ok: true, value: undefined };
  if (typeof rawTemplateId !== "string") {
    return routeFailure(
      failureResponse(400, "template_invalid", "templateId must be a supported template id."),
    );
  }

  const trimmed = rawTemplateId.trim();
  if (!isProposalDraftTemplateId(trimmed)) {
    return routeFailure(
      failureResponse(
        400,
        "template_invalid",
        `templateId must be one of: ${PROPOSAL_DRAFT_TEMPLATE_IDS.join(", ")}.`,
      ),
    );
  }

  return { ok: true, value: trimmed };
}

function firstDraftTemplateId(draft: ProposalDraft): ProposalDraftTemplateId {
  return draft.templateIds[0] ?? DEFAULT_TEMPLATE_ID;
}

function isProposalDraftTemplateId(input: string): input is ProposalDraftTemplateId {
  return PROPOSAL_DRAFT_TEMPLATE_IDS.some((id) => id === input);
}

function resolveAudience(input: unknown): RouteValueResult<ProposalAudience> {
  const rawAudience = readOptionalUnknown(input, "audience");
  if (rawAudience === undefined) return { ok: true, value: "client" };
  if (rawAudience === "client" || rawAudience === "internal") {
    return { ok: true, value: rawAudience };
  }

  return routeFailure(
    failureResponse(400, "audience_invalid", "Audience must be either client or internal."),
  );
}

function resolveAnalysisOptions(input: unknown): RouteValueResult<AnalyzeOptions> {
  const seed = readOptionalPositiveInteger(input, "seed", Number.MAX_SAFE_INTEGER);
  if (!seed.ok) return seed;

  const iterations = readOptionalPositiveInteger(input, "iterations", MAX_ITERATIONS);
  if (!iterations.ok) return iterations;

  return {
    ok: true,
    value: {
      ...(seed.value === undefined ? {} : { seed: seed.value }),
      ...(iterations.value === undefined ? {} : { iterations: iterations.value }),
    },
  };
}

function resolveGeneratedAt(input: unknown): RouteValueResult<Date | undefined> {
  const rawGeneratedAt = readOptionalUnknown(input, "generatedAt");
  if (rawGeneratedAt === undefined) return { ok: true, value: undefined };
  if (typeof rawGeneratedAt !== "string" || rawGeneratedAt.trim().length === 0) {
    return routeFailure(
      failureResponse(400, "generated_at_invalid", "generatedAt must be an ISO date string."),
    );
  }

  const date = new Date(rawGeneratedAt);
  if (Number.isNaN(date.valueOf())) {
    return routeFailure(
      failureResponse(400, "generated_at_invalid", "generatedAt must be a valid date string."),
    );
  }
  return { ok: true, value: date };
}

function readOptionalPositiveInteger(
  input: unknown,
  key: string,
  max: number,
): RouteValueResult<number | undefined> {
  const rawValue = readOptionalUnknown(input, key);
  if (rawValue === undefined) return { ok: true, value: undefined };

  if (typeof rawValue !== "number" || !Number.isInteger(rawValue) || rawValue <= 0) {
    return routeFailure(
      failureResponse(400, `${key}_invalid`, `${key} must be a positive integer.`),
    );
  }
  if (rawValue > max) {
    return routeFailure(
      failureResponse(400, `${key}_too_large`, `${key} must be less than or equal to ${max}.`),
    );
  }

  return { ok: true, value: rawValue };
}

function readOptionalString(input: unknown, key: string): string | undefined {
  const rawValue = readOptionalUnknown(input, key);
  if (typeof rawValue !== "string") return undefined;
  const trimmed = rawValue.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readOptionalUnknown(input: unknown, key: string): unknown {
  if (!isRecord(input)) return undefined;
  return input[key];
}

function looksLikeProposalEnvelope(input: unknown): boolean {
  return isRecord(input) && (Object.hasOwn(input, "draft") || Object.hasOwn(input, "intake"));
}

function looksLikeProposalDraft(input: unknown): boolean {
  return (
    isRecord(input) &&
    Array.isArray(input.templateIds) &&
    isRecord(input.metadata) &&
    isRecord(input.valueProposal) &&
    Array.isArray(input.buildPlan)
  );
}

function looksLikeProposalIntake(input: unknown): boolean {
  return (
    isRecord(input) &&
    isRecord(input.project) &&
    isRecord(input.preparedFor) &&
    isRecord(input.details) &&
    Array.isArray(input.scope) &&
    Array.isArray(input.milestones)
  );
}

function validationFailureResult<T>(
  message: string,
  errors: readonly ProposalValidationError[],
): RouteValueResult<T> {
  return routeFailure(validationFailureResponse(message, errors));
}

function validationFailureResponse(
  message: string,
  errors: readonly ProposalValidationError[],
): ApiRouteResponse {
  return failureResponse(
    422,
    "validation_failed",
    message,
    errors.map((error) => `${error.path}: ${error.message}`),
  );
}

function routeFailure<T>(response: ApiRouteResponse): RouteValueResult<T> {
  return { ok: false, response };
}

function reservedEndpointResponse(code: string, message: string): ApiRouteResponse {
  return failureResponse(501, code, message);
}

function noContentResponse(): ApiRouteResponse {
  return {
    kind: "binary",
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: new Uint8Array(),
  };
}

function jsonResponse(status: number, body: unknown): ApiRouteResponse {
  return {
    kind: "json",
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
    body,
  };
}

function failureResponse(
  status: number,
  code: string,
  message: string,
  details: readonly string[] | undefined = undefined,
): ApiRouteResponse {
  return jsonResponse(status, {
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
}

function canonicalPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function sanitizePdfFileName(input: string): string {
  const withoutPath = input.split(/[\\/]+/).at(-1) ?? "proposal.pdf";
  const normalized = withoutPath
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = normalized.length === 0 ? "proposal.pdf" : normalized;
  const withExtension = fallback.toLowerCase().endsWith(".pdf") ? fallback : `${fallback}.pdf`;
  return withExtension.replace(/["\\]/g, "-");
}

function pdfRenderFailureResponse(error: unknown): ApiRouteResponse {
  const message = error instanceof Error ? error.message : String(error);
  if (isMissingChromiumError(error)) {
    return failureResponse(
      503,
      "chromium_missing",
      "Playwright Chromium is not installed. Run `npx playwright install chromium` from the project root, then try Download PDF again.",
      [message],
    );
  }

  return failureResponse(503, "pdf_render_failed", message);
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
