import {
  WebsiteBrandFetchError,
  extractWebsiteBrand as extractWebsiteBrandFromUrl,
} from "../brand/websiteBrand.node.js";
import type {
  ExtractWebsiteBrandOptions,
  WebsiteBrandExtractionResult,
  WebsiteBrandLookup,
  WebsiteBrandManualOverrides,
} from "../brand/types.js";
import type { AgentConfigSummary } from "../agent/config.node.js";
import { logError, logEvent } from "../diagnostics/logger.node.js";
import {
  analyzeProject,
  DEFAULT_ITERATIONS,
  type AnalyzeOptions,
  type Project,
} from "../core/index.js";
import { validateProject } from "../data/schema.js";
import {
  createProposalAuthorMetadata,
  getCurrentProjectVersion,
  toProposalProjectId,
  toProposalProjectVersionId,
} from "../project/state.js";
import {
  createLocalProposalProjectStore,
  isProposalProjectVersionConflictError,
  projectConflictMetadata,
  type ProposalProjectConflictMetadata,
  type ProposalProjectListItem,
  type ProposalProjectStoreLoadResult,
  type SaveProposalProjectArtifactInput,
  type SaveProposalProjectArtifactResult,
} from "../project/store.node.js";
import type {
  CommitProposalProjectVersionInput,
  CreateProposalProjectInput,
  ProposalArtifactRenderMetadata,
  ProposalArtifactMetadata,
  ProposalAuthorKind,
  ProposalAuthorMetadata,
  ProposalBrandExtractionProvenance,
  ProposalBrandRole,
  ProposalProject,
  ProposalProjectId,
  ProposalProjectSourceOfTruth,
  ProposalProjectStatus,
  ProposalProjectVersion,
  ProposalProjectVersionId,
  ProposalProjectVersionSource,
} from "../project/types.js";
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
  PreparedFor,
  ProposalAudience,
  ProposalBrand,
  ProposalBrandColors,
  ProposalDraft,
  ProposalDraftTemplateId,
  ProposalIntake,
  ProposalValidationError,
} from "../proposal/types.js";
import { isMissingChromiumError, renderProposalPdfBytes } from "../render/pdf.node.js";
import { renderValueProposalHtml } from "../render/valueProposalHtml.js";
import type { ProposalAgentStreamRunner } from "./agentStream.node.js";

const API_PREFIX = "/api";
const DEFAULT_BRAND_ID = "nolan";
const MAX_BRAND_BYTES = 5_000_000;
const MAX_BRAND_REDIRECTS = 8;
const MAX_BRAND_TIMEOUT_MS = 30_000;
const DEFAULT_PDF_FORMAT = "Letter";
const DEFAULT_TEMPLATE_ID = "generic/value-proposal" satisfies ProposalDraftTemplateId;
const DEFAULT_ANALYSIS_SEED = 7;
const PROJECT_HTML_RENDERER = "scopeforge.valueProposalHtml";
const PROJECT_PDF_RENDERER = "scopeforge.proposalPdf";
const PROJECT_RENDERER_VERSION = 1;
const MAX_ITERATIONS = 250_000;
const PROPOSAL_PROJECT_ROUTE_NAMES = ["proposal-projects", "projects"] as const;
const PROPOSAL_PROJECT_STATUSES = [
  "active",
  "archived",
] as const satisfies readonly ProposalProjectStatus[];
const PROPOSAL_PROJECT_VERSION_SOURCES = [
  "human-edit",
  "agent-edit",
  "import",
  "restore",
  "system",
] as const satisfies readonly ProposalProjectVersionSource[];
const PROPOSAL_AUTHOR_KINDS = [
  "human",
  "agent",
  "system",
] as const satisfies readonly ProposalAuthorKind[];
const DEFAULT_PROJECT_AUTHOR = createProposalAuthorMetadata({
  authorId: "local-collaborator",
  displayName: "Local collaborator",
  kind: "human",
});
const PROPOSAL_BRAND_COLOR_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text",
  "mutedText",
  "border",
] as const satisfies readonly (keyof ProposalBrandColors)[];

type WebsiteBrandManualStringKey = Exclude<keyof WebsiteBrandManualOverrides, "colors" | "notes">;

const WEBSITE_BRAND_MANUAL_STRING_KEYS = [
  "id",
  "name",
  "legalName",
  "tagline",
  "website",
  "email",
  "phone",
  "logoText",
  "logoUrl",
  "source",
] as const satisfies readonly WebsiteBrandManualStringKey[];

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

export type WebsiteBrandExtractor = (
  url: string,
  options: ExtractWebsiteBrandOptions,
) => Promise<WebsiteBrandExtractionResult>;

export interface ProposalProjectStore {
  readonly load?: () => Promise<ProposalProjectStoreLoadResult>;
  readonly list: () => readonly ProposalProjectListItem[];
  readonly get: (projectId: ProposalProjectId) => ProposalProject | null;
  readonly create: (input: CreateProposalProjectInput) => Promise<ProposalProject>;
  readonly update: (
    projectId: ProposalProjectId,
    input: CommitProposalProjectVersionInput,
  ) => Promise<ProposalProject | null>;
  readonly saveArtifact: (
    projectId: ProposalProjectId,
    input: SaveProposalProjectArtifactInput,
  ) => Promise<SaveProposalProjectArtifactResult | null>;
}

export interface AppRouteDependencies {
  readonly renderPdf?: ProposalPdfRenderer;
  readonly extractWebsiteBrand?: WebsiteBrandExtractor;
  readonly proposalProjectStore?: ProposalProjectStore;
  readonly brandFetch?: typeof fetch;
  readonly brandLookupHost?: WebsiteBrandLookup;
  readonly brandNow?: () => Date;
  readonly agentSummary?: AgentConfigSummary;
  readonly runProposalAgentStream?: ProposalAgentStreamRunner;
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

interface BrandExtractRouteInput {
  readonly url: string;
  readonly manualOverrides?: WebsiteBrandManualOverrides;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
}

type RouteValueResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: ApiRouteResponse };

type ProposalProjectRoute =
  | { readonly action: "collection" }
  | { readonly action: "state"; readonly projectId: ProposalProjectId }
  | { readonly action: "versions"; readonly projectId: ProposalProjectId }
  | { readonly action: "updates"; readonly projectId: ProposalProjectId }
  | { readonly action: "preview"; readonly projectId: ProposalProjectId }
  | { readonly action: "exportPdf"; readonly projectId: ProposalProjectId }
  | { readonly action: "importBrand"; readonly projectId: ProposalProjectId };

interface LoadedProposalProject {
  readonly store: ProposalProjectStore;
  readonly project: ProposalProject;
}

interface ProposalProjectSourceDefaults {
  readonly vendorBrand: ProposalBrand;
  readonly clientBrand: ProposalBrand;
}

interface ProposalProjectVersionSummary {
  readonly versionId: ProposalProjectVersionId;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly createdBy: ProposalAuthorMetadata;
  readonly source: ProposalProjectVersionSource;
  readonly label?: string;
  readonly reason?: string;
}

interface ProposalProjectArtifactSummary {
  readonly artifactCount: number;
  readonly latestArtifact?: ProposalArtifactMetadata;
  readonly latestPdfArtifact?: ProposalArtifactMetadata;
  readonly latestPreviewArtifact?: ProposalArtifactMetadata;
}

export async function handleApiRoute(
  request: AppRouteRequest,
  dependencies: AppRouteDependencies = {},
): Promise<ApiRouteResponse | null> {
  const pathname = canonicalPath(request.pathname);
  if (!pathname.startsWith(API_PREFIX)) return null;

  if (request.method === "OPTIONS") return noContentResponse();
  if (request.method === "GET" && pathname === "/api/health") {
    return healthResponse(dependencies.agentSummary);
  }
  if (request.method === "GET" && pathname === "/api/brands") return brandsResponse();

  const proposalProjectRoute = parseProposalProjectRoute(pathname);
  if (proposalProjectRoute !== null) {
    return handleProposalProjectRoute(proposalProjectRoute, request, dependencies);
  }

  if (request.method === "POST" && pathname === "/api/brands/validate") {
    return validateBrandResponse(request.body);
  }
  if (request.method === "POST" && pathname === "/api/brand/extract") {
    return extractBrandResponse(request.body, dependencies);
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

async function handleProposalProjectRoute(
  route: ProposalProjectRoute,
  request: AppRouteRequest,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  switch (route.action) {
    case "collection":
      if (request.method === "GET") return listProposalProjectsResponse(dependencies);
      if (request.method === "POST")
        return createProposalProjectResponse(request.body, dependencies);
      return methodNotAllowedResponse(
        "GET, POST",
        "Proposal project collections support list and create.",
      );
    case "state":
      if (request.method === "GET")
        return latestProposalProjectStateResponse(route.projectId, dependencies);
      if (request.method === "PATCH" || request.method === "PUT") {
        return updateProposalProjectResponse(route.projectId, request.body, dependencies);
      }
      return methodNotAllowedResponse(
        "GET, PATCH, PUT",
        "Proposal project state supports read and base-versioned updates.",
      );
    case "versions":
      if (request.method === "GET")
        return proposalProjectVersionHistoryResponse(route.projectId, dependencies);
      return methodNotAllowedResponse("GET", "Proposal project version history is read-only.");
    case "updates":
      if (request.method === "GET")
        return latestProposalProjectUpdatesResponse(route.projectId, dependencies);
      return methodNotAllowedResponse("GET", "Proposal project updates are read-only.");
    case "preview":
      if (request.method === "GET" || request.method === "POST") {
        return previewLatestProposalProjectResponse(
          route.projectId,
          request.body,
          request.method === "POST",
          dependencies,
        );
      }
      return methodNotAllowedResponse(
        "GET, POST",
        "Proposal project preview renders the latest state.",
      );
    case "exportPdf":
      if (request.method === "POST") {
        return exportLatestProposalProjectPdfResponse(
          route.projectId,
          request.body,
          request.signal,
          dependencies,
        );
      }
      return methodNotAllowedResponse(
        "POST",
        "Proposal project PDF export requires a POST request.",
      );
    case "importBrand":
      if (request.method === "POST") {
        return importProposalProjectWebsiteBrandResponse(
          route.projectId,
          request.body,
          dependencies,
        );
      }
      return methodNotAllowedResponse(
        "POST",
        "Proposal project brand imports require a POST request.",
      );
  }
}

async function listProposalProjectsResponse(
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const store = await loadProposalProjectStore(dependencies);
  if (!store.ok) return store.response;

  return jsonResponse(200, {
    ok: true,
    projects: store.value.list(),
  });
}

async function createProposalProjectResponse(
  input: unknown,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const createInput = resolveCreateProposalProjectInput(input);
  if (!createInput.ok) return createInput.response;

  const store = await loadProposalProjectStore(dependencies);
  if (!store.ok) return store.response;

  try {
    const project = await store.value.create(createInput.value);
    const currentVersion = getCurrentProjectVersion(project);
    return jsonResponse(201, {
      ok: true,
      project,
      ...(currentVersion === null
        ? {}
        : { currentVersion, sourceOfTruth: currentVersion.sourceOfTruth }),
    });
  } catch (error) {
    return projectStoreWriteFailureResponse("project_create_failed", error);
  }
}

async function latestProposalProjectStateResponse(
  projectId: ProposalProjectId,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const loaded = await loadProposalProject(projectId, dependencies);
  if (!loaded.ok) return loaded.response;

  const currentVersion = currentProjectVersionResult(loaded.value.project);
  if (!currentVersion.ok) return currentVersion.response;

  return jsonResponse(200, {
    ok: true,
    projectId: loaded.value.project.projectId,
    project: loaded.value.project,
    currentVersion: currentVersion.value,
    sourceOfTruth: currentVersion.value.sourceOfTruth,
  });
}

async function proposalProjectVersionHistoryResponse(
  projectId: ProposalProjectId,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const loaded = await loadProposalProject(projectId, dependencies);
  if (!loaded.ok) return loaded.response;

  return jsonResponse(200, {
    ok: true,
    projectId: loaded.value.project.projectId,
    currentVersionId: loaded.value.project.currentVersionId,
    versions: loaded.value.project.versions,
  });
}

async function latestProposalProjectUpdatesResponse(
  projectId: ProposalProjectId,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const loaded = await loadProposalProject(projectId, dependencies);
  if (!loaded.ok) return loaded.response;

  const currentVersion = currentProjectVersionResult(loaded.value.project);
  if (!currentVersion.ok) return currentVersion.response;

  return jsonResponse(200, {
    ok: true,
    projectId: loaded.value.project.projectId,
    latestProject: projectConflictMetadata(loaded.value.project),
    latestVersion: summarizeProjectVersion(currentVersion.value),
    artifactSummary: summarizeProjectArtifacts(loaded.value.project),
  });
}

function summarizeProjectVersion(version: ProposalProjectVersion): ProposalProjectVersionSummary {
  return {
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    source: version.source,
    ...(version.label === undefined ? {} : { label: version.label }),
    ...(version.reason === undefined ? {} : { reason: version.reason }),
  } satisfies ProposalProjectVersionSummary;
}

function summarizeProjectArtifacts(project: ProposalProject): ProposalProjectArtifactSummary {
  const artifacts = [...project.artifacts].sort(compareArtifactsNewestFirst);
  const latestArtifact = artifacts[0];
  const latestPdfArtifact = artifacts.find((artifact) => artifact.kind === "proposal-pdf");
  const latestPreviewArtifact = artifacts.find((artifact) => artifact.kind === "proposal-preview");

  return {
    artifactCount: project.artifacts.length,
    ...(latestArtifact === undefined ? {} : { latestArtifact }),
    ...(latestPdfArtifact === undefined ? {} : { latestPdfArtifact }),
    ...(latestPreviewArtifact === undefined ? {} : { latestPreviewArtifact }),
  } satisfies ProposalProjectArtifactSummary;
}

function compareArtifactsNewestFirst(
  left: ProposalArtifactMetadata,
  right: ProposalArtifactMetadata,
): number {
  const createdAt = right.createdAt.localeCompare(left.createdAt);
  if (createdAt !== 0) return createdAt;
  return right.artifactId.localeCompare(left.artifactId);
}

async function updateProposalProjectResponse(
  projectId: ProposalProjectId,
  input: unknown,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const loaded = await loadProposalProject(projectId, dependencies);
  if (!loaded.ok) return loaded.response;

  const updateInput = resolveUpdateProposalProjectInput(input, loaded.value.project);
  if (!updateInput.ok) return updateInput.response;

  try {
    const updated = await loaded.value.store.update(projectId, updateInput.value);
    if (updated === null) return proposalProjectNotFoundResponse(projectId);

    const currentVersion = getCurrentProjectVersion(updated);
    return jsonResponse(200, {
      ok: true,
      project: updated,
      ...(currentVersion === null
        ? {}
        : { currentVersion, sourceOfTruth: currentVersion.sourceOfTruth }),
    });
  } catch (error) {
    if (isProposalProjectVersionConflictError(error)) {
      return projectVersionConflictResponse({
        providedBaseVersionId: error.providedBaseVersionId,
        latestProject: error.latestProject,
        retryInstruction:
          "Fetch the latest project state and retry the update against the current version.",
      });
    }
    return projectStoreWriteFailureResponse("project_update_failed", error);
  }
}

async function importProposalProjectWebsiteBrandResponse(
  projectId: ProposalProjectId,
  input: unknown,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const loaded = await loadProposalProject(projectId, dependencies);
  if (!loaded.ok) return loaded.response;

  const currentVersion = currentProjectVersionResult(loaded.value.project);
  if (!currentVersion.ok) return currentVersion.response;

  const importInput = resolveProjectBrandImportInput(input, loaded.value.project);
  if (!importInput.ok) return importInput.response;

  const extractor = dependencies.extractWebsiteBrand ?? extractWebsiteBrandFromUrl;
  try {
    const result = await extractor(
      importInput.value.extract.url,
      buildWebsiteBrandExtractOptions(importInput.value.extract, dependencies),
    );
    const brandResult = validateProposalBrand(result.proposalBrand);
    if (!brandResult.ok) {
      return validationFailureResponse("Extracted brand profile is invalid.", brandResult.errors);
    }

    const importedAt = importInput.value.createdAt ?? result.source.fetchedAt;
    const provenance = buildBrandExtractionProvenance(importInput.value.role, result, importedAt);
    const sourceOfTruth = applyImportedProjectBrand(
      currentVersion.value.sourceOfTruth,
      importInput.value.role,
      brandResult.value,
    );
    const brandProvenance = buildBrandProvenanceInput(importInput.value.role, provenance);
    const label =
      importInput.value.label ??
      `${brandRoleLabel(importInput.value.role)} brand import from website`;
    const reason =
      importInput.value.reason ??
      `Imported ${brandRoleLabel(importInput.value.role).toLowerCase()} brand from ${result.source.finalUrl}.`;

    const updated = await updateProjectWithImportedBrand(loaded.value.store, projectId, {
      sourceOfTruth,
      createdBy: importInput.value.createdBy,
      parentVersionId: importInput.value.baseVersionId,
      source: "import",
      label,
      reason,
      brandProvenance,
      ...(importInput.value.createdAt === undefined
        ? {}
        : { createdAt: importInput.value.createdAt }),
    });
    if (!updated.ok) return updated.response;

    const updatedVersion = getCurrentProjectVersion(updated.value);
    return jsonResponse(200, {
      ok: true,
      role: importInput.value.role,
      brand: brandResult.value,
      provenance,
      project: updated.value,
      ...(updatedVersion === null
        ? {}
        : { currentVersion: updatedVersion, sourceOfTruth: updatedVersion.sourceOfTruth }),
      source: result.source,
      sources: result.sources,
      meta: result.meta,
      palette: result.palette,
      assets: result.assets,
      favicons: result.favicons,
      logos: result.logos,
      ogImages: result.ogImages,
      colors: result.colors,
      ...(result.name === undefined ? {} : { name: result.name }),
      ...(result.tagline === undefined ? {} : { tagline: result.tagline }),
      ...(result.logoUrl === undefined ? {} : { logoUrl: result.logoUrl }),
      ...(result.manualOverrides === undefined ? {} : { manualOverrides: result.manualOverrides }),
    });
  } catch (error) {
    logError("scopeforge.route.project_brand_import_failed", error, {
      projectId,
      url: importInput.value.extract.url,
      role: importInput.value.role,
    });
    return websiteBrandFailureResponse(error);
  }
}

async function updateProjectWithImportedBrand(
  store: ProposalProjectStore,
  projectId: ProposalProjectId,
  input: CommitProposalProjectVersionInput,
): Promise<RouteValueResult<ProposalProject>> {
  try {
    const updated = await store.update(projectId, input);
    if (updated === null) return routeFailure(proposalProjectNotFoundResponse(projectId));
    return { ok: true, value: updated };
  } catch (error) {
    if (isProposalProjectVersionConflictError(error)) {
      return routeFailure(
        projectVersionConflictResponse({
          providedBaseVersionId: error.providedBaseVersionId,
          latestProject: error.latestProject,
          retryInstruction:
            "Fetch the latest project state and retry the brand import against the current version.",
        }),
      );
    }
    return routeFailure(projectStoreWriteFailureResponse("project_brand_import_failed", error));
  }
}

interface ProjectBrandImportInput {
  readonly role: ProposalBrandRole;
  readonly baseVersionId: ProposalProjectVersionId;
  readonly extract: BrandExtractRouteInput;
  readonly createdBy: ProposalAuthorMetadata;
  readonly createdAt?: string;
  readonly label?: string;
  readonly reason?: string;
}

function resolveProjectBrandImportInput(
  input: unknown,
  project: ProposalProject,
): RouteValueResult<ProjectBrandImportInput> {
  if (!isRecord(input)) {
    return routeFailure(
      failureResponse(
        400,
        "project_brand_import_request_invalid",
        "Project brand import request body must be a JSON object.",
      ),
    );
  }

  const role = resolveProjectBrandImportRole(input.role);
  if (!role.ok) return role;

  const baseVersionId = resolveRequiredBaseVersionId(input);
  if (!baseVersionId.ok) return baseVersionId;
  if (baseVersionId.value !== project.currentVersionId) {
    return routeFailure(
      projectVersionConflictResponse({
        providedBaseVersionId: baseVersionId.value,
        latestProject: projectConflictMetadata(project),
        retryInstruction:
          "Fetch the latest project state and retry the brand import against the current version.",
      }),
    );
  }

  const extract = resolveBrandExtractInput(input);
  if (!extract.ok) return extract;

  const createdBy = resolveProposalProjectAuthor(input);
  if (!createdBy.ok) return createdBy;

  const createdAt = readOptionalRouteString(input, "createdAt", "created_at_invalid", "createdAt");
  if (!createdAt.ok) return createdAt;

  const label = readOptionalRouteString(input, "label", "label_invalid", "label");
  if (!label.ok) return label;

  const reason = readOptionalRouteString(input, "reason", "reason_invalid", "reason");
  if (!reason.ok) return reason;

  return {
    ok: true,
    value: {
      role: role.value,
      baseVersionId: baseVersionId.value,
      extract: extract.value,
      createdBy: createdBy.value,
      ...(createdAt.value === undefined ? {} : { createdAt: createdAt.value }),
      ...(label.value === undefined ? {} : { label: label.value }),
      ...(reason.value === undefined ? {} : { reason: reason.value }),
    },
  };
}

function resolveProjectBrandImportRole(input: unknown): RouteValueResult<ProposalBrandRole> {
  if (input === "vendor" || input === "client") return { ok: true, value: input };
  return routeFailure(
    failureResponse(400, "brand_role_invalid", "role must be either vendor or client."),
  );
}

function buildBrandExtractionProvenance(
  role: ProposalBrandRole,
  result: WebsiteBrandExtractionResult,
  importedAt: string,
): ProposalBrandExtractionProvenance {
  return {
    kind: "website-brand-extraction",
    role,
    importedAt,
    source: result.source,
    sources: result.sources,
    meta: result.meta,
    palette: result.palette,
    ...(result.manualOverrides === undefined ? {} : { manualOverrides: result.manualOverrides }),
  } satisfies ProposalBrandExtractionProvenance;
}

function buildBrandProvenanceInput(
  role: ProposalBrandRole,
  provenance: ProposalBrandExtractionProvenance,
): Partial<Record<ProposalBrandRole, ProposalBrandExtractionProvenance>> {
  return role === "vendor" ? { vendor: provenance } : { client: provenance };
}

function applyImportedProjectBrand(
  sourceOfTruth: ProposalProjectSourceOfTruth,
  role: ProposalBrandRole,
  brand: ProposalBrand,
): ProposalProjectSourceOfTruth {
  if (role === "vendor") {
    return { ...sourceOfTruth, vendorBrand: brand } satisfies ProposalProjectSourceOfTruth;
  }

  return {
    ...sourceOfTruth,
    draft: applyClientBrandToDraft(sourceOfTruth.draft, brand),
    clientBrand: brand,
  } satisfies ProposalProjectSourceOfTruth;
}

function applyClientBrandToDraft(draft: ProposalDraft, brand: ProposalBrand): ProposalDraft {
  return {
    ...draft,
    preparedFor: {
      ...draft.preparedFor,
      companyName: brand.name,
      ...(brand.website === undefined ? {} : { website: brand.website }),
      logoText: brand.logoText,
      accentColor: brand.colors.accent,
    },
  } satisfies ProposalDraft;
}

function brandRoleLabel(role: ProposalBrandRole): string {
  return role === "vendor" ? "Vendor" : "Client";
}

async function previewLatestProposalProjectResponse(
  projectId: ProposalProjectId,
  input: unknown,
  requiresBaseVersion: boolean,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const loaded = await loadProposalProject(projectId, dependencies);
  if (!loaded.ok) return loaded.response;

  if (requiresBaseVersion) {
    const baseVersion = resolveRequiredProjectActionBaseVersion(
      input,
      loaded.value.project,
      "preview",
    );
    if (!baseVersion.ok) return baseVersion.response;
  }

  const currentVersion = currentProjectVersionResult(loaded.value.project);
  if (!currentVersion.ok) return currentVersion.response;

  const bundle = buildLatestProjectRenderBundle(currentVersion.value, input);
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

  const createdBy = resolveProjectActionAuthor(input);
  if (!createdBy.ok) return createdBy.response;

  const artifact = await saveProjectRenderArtifact(
    loaded.value.store,
    loaded.value.project.projectId,
    {
      kind: "proposal-preview",
      origin: "render",
      content: bundle.value.html,
      createdBy: createdBy.value,
      sourceVersionId: currentVersion.value.versionId,
      expectedCurrentVersionId: currentVersion.value.versionId,
      fileName: sanitizeHtmlFileName(
        readOptionalString(input, "fileName") ??
          `${bundle.value.proposal.intake.preparedFor.companyName}-proposal-preview.html`,
      ),
      mimeType: "text/html; charset=utf-8",
      label: `HTML preview for project version ${currentVersion.value.versionNumber}`,
      render: buildProjectArtifactRenderMetadata(currentVersion.value, bundle.value, {
        renderer: PROJECT_HTML_RENDERER,
      }),
    },
    "preview",
  );
  if (!artifact.ok) return artifact.response;

  return jsonResponse(200, {
    ok: true,
    projectId: loaded.value.project.projectId,
    currentVersionId: currentVersion.value.versionId,
    kind: bundle.value.proposal.kind,
    templateId: bundle.value.proposal.templateId,
    audience: bundle.value.audience,
    brand: bundle.value.brand,
    analysis,
    warnings: analysis.warnings,
    html: bundle.value.html,
    artifact: artifact.value.artifact,
    project: artifact.value.project,
  });
}

async function exportLatestProposalProjectPdfResponse(
  projectId: ProposalProjectId,
  input: unknown,
  signal: AbortSignal | undefined,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const loaded = await loadProposalProject(projectId, dependencies);
  if (!loaded.ok) return loaded.response;

  const baseVersion = resolveRequiredProjectActionBaseVersion(
    input,
    loaded.value.project,
    "PDF export",
  );
  if (!baseVersion.ok) return baseVersion.response;

  const currentVersion = currentProjectVersionResult(loaded.value.project);
  if (!currentVersion.ok) return currentVersion.response;

  const bundle = buildLatestProjectRenderBundle(currentVersion.value, input);
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

  const createdBy = resolveProjectActionAuthor(input);
  if (!createdBy.ok) return createdBy.response;

  const format = readOptionalString(input, "format") ?? DEFAULT_PDF_FORMAT;
  const fileName = sanitizePdfFileName(
    readOptionalString(input, "fileName") ??
      `${bundle.value.proposal.intake.preparedFor.companyName}-proposal.pdf`,
  );
  const htmlFileName = pdfFileNameToHtmlFileName(fileName);
  const renderPdf = dependencies.renderPdf ?? renderPdfWithPlaywright;

  try {
    const pdf = await renderPdf({
      html: bundle.value.html,
      format,
      ...(signal === undefined ? {} : { signal }),
    });

    const htmlArtifact = await saveProjectRenderArtifact(
      loaded.value.store,
      loaded.value.project.projectId,
      {
        kind: "proposal-html",
        origin: "render",
        content: bundle.value.html,
        createdBy: createdBy.value,
        sourceVersionId: currentVersion.value.versionId,
        expectedCurrentVersionId: currentVersion.value.versionId,
        fileName: htmlFileName,
        mimeType: "text/html; charset=utf-8",
        label: `Rendered HTML for project version ${currentVersion.value.versionNumber}`,
        render: buildProjectArtifactRenderMetadata(currentVersion.value, bundle.value, {
          renderer: PROJECT_HTML_RENDERER,
        }),
      },
      "PDF export HTML render",
    );
    if (!htmlArtifact.ok) return htmlArtifact.response;

    const pdfArtifact = await saveProjectRenderArtifact(
      loaded.value.store,
      loaded.value.project.projectId,
      {
        kind: "proposal-pdf",
        origin: "render",
        content: pdf.bytes,
        createdBy: createdBy.value,
        sourceVersionId: currentVersion.value.versionId,
        expectedCurrentVersionId: currentVersion.value.versionId,
        fileName,
        mimeType: "application/pdf",
        label: `PDF export for project version ${currentVersion.value.versionNumber}`,
        render: buildProjectArtifactRenderMetadata(currentVersion.value, bundle.value, {
          renderer: PROJECT_PDF_RENDERER,
          format: pdf.format,
        }),
      },
      "PDF export",
    );
    if (!pdfArtifact.ok) return pdfArtifact.response;

    return {
      kind: "binary",
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(pdf.bytes.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
        "X-ScopeForge-Html-Artifact-Id": htmlArtifact.value.artifact.artifactId,
        "X-ScopeForge-Html-Artifact-Uri": htmlArtifact.value.artifact.uri,
        "X-ScopeForge-Pdf-Artifact-Id": pdfArtifact.value.artifact.artifactId,
        "X-ScopeForge-Pdf-Artifact-Uri": pdfArtifact.value.artifact.uri,
        "X-ScopeForge-Pdf-Format": pdf.format,
      },
      body: pdf.bytes,
    };
  } catch (error) {
    logError("scopeforge.route.project_pdf_render_failed", error, {
      projectId,
      versionId: currentVersion.value.versionId,
      format,
      fileName,
    });
    return pdfRenderFailureResponse(error);
  }
}

function resolveProjectActionAuthor(input: unknown): RouteValueResult<ProposalAuthorMetadata> {
  return resolveProposalProjectAuthor(isRecord(input) ? input : {});
}

interface ProjectArtifactRenderMetadataInput {
  readonly renderer: string;
  readonly format?: string;
}

function buildProjectArtifactRenderMetadata(
  version: ProposalProjectVersion,
  bundle: ProposalRenderBundle,
  input: ProjectArtifactRenderMetadataInput,
): ProposalArtifactRenderMetadata {
  const analysis = resolvedAnalysisMetadata(bundle.analysisOptions);
  return {
    renderer: input.renderer,
    rendererVersion: PROJECT_RENDERER_VERSION,
    audience: bundle.audience,
    templateId: bundle.proposal.templateId,
    analysisSeed: analysis.seed,
    analysisIterations: analysis.iterations,
    draftHash: version.hashes.draftHash,
    vendorBrandHash: version.hashes.vendorBrandHash,
    clientBrandHash: version.hashes.clientBrandHash,
    sourceHash: version.hashes.sourceHash,
    ...(bundle.generatedAt === undefined ? {} : { generatedAt: bundle.generatedAt.toISOString() }),
    ...(input.format === undefined ? {} : { format: input.format }),
  } satisfies ProposalArtifactRenderMetadata;
}

function resolvedAnalysisMetadata(options: AnalyzeOptions): {
  readonly seed: number;
  readonly iterations: number;
} {
  return {
    seed: options.seed ?? DEFAULT_ANALYSIS_SEED,
    iterations: options.iterations ?? DEFAULT_ITERATIONS,
  };
}

async function saveProjectRenderArtifact(
  store: ProposalProjectStore,
  projectId: ProposalProjectId,
  input: SaveProposalProjectArtifactInput,
  actionLabel: string,
): Promise<RouteValueResult<SaveProposalProjectArtifactResult>> {
  try {
    const saved = await store.saveArtifact(projectId, input);
    if (saved === null) return routeFailure(proposalProjectNotFoundResponse(projectId));
    return { ok: true, value: saved };
  } catch (error) {
    if (isProposalProjectVersionConflictError(error)) {
      return routeFailure(
        projectVersionConflictResponse({
          providedBaseVersionId: error.providedBaseVersionId,
          latestProject: error.latestProject,
          retryInstruction: `Fetch the latest project state and retry ${actionLabel.toLowerCase()} against the current version.`,
        }),
      );
    }
    return routeFailure(projectStoreWriteFailureResponse("project_artifact_save_failed", error));
  }
}

function sanitizeHtmlFileName(input: string): string {
  const withoutPath = input.split(/[\\/]+/).at(-1) ?? "proposal.html";
  const normalized = withoutPath
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = normalized.length === 0 ? "proposal.html" : normalized;
  const withExtension = fallback.toLowerCase().endsWith(".html") ? fallback : `${fallback}.html`;
  return withExtension.replace(/["\\]/g, "-");
}

function pdfFileNameToHtmlFileName(fileName: string): string {
  return sanitizeHtmlFileName(fileName.replace(/\.pdf$/i, ".html"));
}

async function loadProposalProject(
  projectId: ProposalProjectId,
  dependencies: AppRouteDependencies,
): Promise<RouteValueResult<LoadedProposalProject>> {
  const store = await loadProposalProjectStore(dependencies);
  if (!store.ok) return store;

  const project = store.value.get(projectId);
  if (project === null) return routeFailure(proposalProjectNotFoundResponse(projectId));
  return { ok: true, value: { store: store.value, project } };
}

async function loadProposalProjectStore(
  dependencies: AppRouteDependencies,
): Promise<RouteValueResult<ProposalProjectStore>> {
  const store = dependencies.proposalProjectStore ?? createLocalProposalProjectStore();
  if (store.load === undefined) return { ok: true, value: store };

  try {
    const loadResult = await store.load();
    if (loadResult.ok) return { ok: true, value: store };
    return routeFailure(
      failureResponse(
        503,
        "project_store_load_failed",
        "Proposal project storage could not be loaded safely.",
        projectStoreLoadFailureDetails(loadResult),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return routeFailure(
      failureResponse(
        503,
        "project_store_unavailable",
        "Proposal project storage is unavailable.",
        [message],
      ),
    );
  }
}

function projectStoreLoadFailureDetails(
  loadResult: ProposalProjectStoreLoadResult,
): readonly string[] {
  if (loadResult.ok) return [];
  return loadResult.errors.map((error) =>
    [
      `code: ${error.code}`,
      `path: ${error.path}`,
      `message: ${error.message}`,
      ...(error.details === undefined ? [] : error.details),
    ].join("; "),
  );
}

function resolveCreateProposalProjectInput(
  input: unknown,
): RouteValueResult<CreateProposalProjectInput> {
  if (!isRecord(input)) {
    return routeFailure(
      failureResponse(
        400,
        "project_request_invalid",
        "Create project request body must be a JSON object.",
      ),
    );
  }

  const sourceInput = withStarterProposalDocument(input);
  const sourceOfTruth = resolveProposalProjectSourceOfTruth(sourceInput);
  if (!sourceOfTruth.ok) return sourceOfTruth;

  const createdBy = resolveProposalProjectAuthor(input);
  if (!createdBy.ok) return createdBy;

  const projectId = resolveOptionalProjectId(input, "projectId");
  if (!projectId.ok) return projectId;

  const versionId = resolveOptionalProjectVersionId(input, "versionId");
  if (!versionId.ok) return versionId;

  const status = resolveOptionalProjectStatus(input);
  if (!status.ok) return status;

  const source = resolveOptionalProjectVersionSource(input);
  if (!source.ok) return source;

  const title = readOptionalRouteString(input, "title", "title_invalid", "title");
  if (!title.ok) return title;

  const createdAt = readOptionalRouteString(input, "createdAt", "created_at_invalid", "createdAt");
  if (!createdAt.ok) return createdAt;

  const label = readOptionalRouteString(input, "label", "label_invalid", "label");
  if (!label.ok) return label;

  return {
    ok: true,
    value: {
      sourceOfTruth: sourceOfTruth.value,
      createdBy: createdBy.value,
      ...(projectId.value === undefined ? {} : { projectId: projectId.value }),
      ...(versionId.value === undefined ? {} : { versionId: versionId.value }),
      ...(title.value === undefined ? {} : { title: title.value }),
      ...(createdAt.value === undefined ? {} : { createdAt: createdAt.value }),
      ...(status.value === undefined ? {} : { status: status.value }),
      ...(label.value === undefined ? {} : { label: label.value }),
      ...(source.value === undefined ? {} : { source: source.value }),
    },
  };
}

function withStarterProposalDocument(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (hasProposalProjectSourceInput(input)) return input;
  return { ...input, draft: createStarterProposalDraft(input) };
}

function hasProposalProjectSourceInput(input: Readonly<Record<string, unknown>>): boolean {
  return (
    Object.hasOwn(input, "sourceOfTruth") ||
    Object.hasOwn(input, "draft") ||
    Object.hasOwn(input, "intake") ||
    looksLikeProposalDraft(input) ||
    looksLikeProposalIntake(input)
  );
}

function createStarterProposalDraft(input: Readonly<Record<string, unknown>>): ProposalDraft {
  const title = readOptionalString(input, "title") ?? "Untitled proposal";
  const companyName =
    readOptionalString(input, "clientName") ??
    readOptionalString(input, "companyName") ??
    "Prospective client";
  const intake = {
    project: createStarterProject(title),
    preparedFor: { companyName },
    details: {
      title,
      recommendation: "Define the highest-value first milestone before sending this proposal.",
      executiveSummary: ["Discovery in progress — gathering goals, value, and scope."],
      whatWeHeard: ["Initial context is still being collected."],
    },
    scope: [
      {
        title: "Discovery and scope definition",
        description: "Clarify the buyer goal, success metric, and first build milestone.",
        deliverables: ["Validated problem statement", "Prioritized pilot scope"],
        outcomes: ["A proposal that can be priced and defended."],
      },
    ],
    milestones: [
      {
        name: "Scope workshop",
        timing: "Week 1",
        outcomes: ["Confirmed goals", "Draft implementation plan"],
      },
    ],
    assumptions: ["The client can provide access to the right business owner."],
    exclusions: ["Production delivery is not committed until scope and economics are confirmed."],
    clientInputs: ["A decision-maker joins the scope workshop."],
    nextSteps: ["Capture the project goal, value thesis, and implementation constraints."],
  } satisfies ProposalIntake;

  return proposalIntakeToDraft(intake, {
    templateId: DEFAULT_TEMPLATE_ID,
    source: "proposal-project-create",
    notes: ["Started from the project picker."],
  });
}

function createStarterProject(title: string): Project {
  return {
    project: title,
    client: { sizeHeadcount: 1, buyerRole: "Business owner", workingWeeks: 46 },
    cost: {
      blendedRate: { optimistic: 120, likely: 150, pessimistic: 185 },
      margin: 0.4,
      workstreams: [
        {
          name: "Scope definition",
          hours: { optimistic: 4, likely: 6, pessimistic: 10 },
          aiFactor: 1,
          judgment: true,
        },
      ],
    },
    value: {
      realizationFactor: { low: 0.45, high: 0.55 },
      segments: [],
      workflows: [{ name: "Value to be validated", low: 5000, high: 10000 }],
      futureUpside: [],
    },
    pricing: {
      valueFraction: { low: 0.1, high: 0.2 },
      tiers: [{ name: "Discovery Sprint", price: 2500 }],
    },
  } satisfies Project;
}

function resolveUpdateProposalProjectInput(
  input: unknown,
  project: ProposalProject,
): RouteValueResult<CommitProposalProjectVersionInput> {
  if (!isRecord(input)) {
    return routeFailure(
      failureResponse(
        400,
        "project_request_invalid",
        "Update project request body must be a JSON object with baseVersionId.",
      ),
    );
  }

  const baseVersionId = resolveRequiredBaseVersionId(input);
  if (!baseVersionId.ok) return baseVersionId;

  if (baseVersionId.value !== project.currentVersionId) {
    return routeFailure(
      projectVersionConflictResponse({
        providedBaseVersionId: baseVersionId.value,
        latestProject: projectConflictMetadata(project),
        retryInstruction:
          "Fetch the latest project state and retry the update against the current version.",
      }),
    );
  }

  const currentVersion = currentProjectVersionResult(project);
  if (!currentVersion.ok) return currentVersion;

  const sourceOfTruth = resolveProposalProjectSourceOfTruth(
    input,
    currentVersion.value.sourceOfTruth,
  );
  if (!sourceOfTruth.ok) return sourceOfTruth;

  const createdBy = resolveProposalProjectAuthor(input);
  if (!createdBy.ok) return createdBy;

  const versionId = resolveOptionalProjectVersionId(input, "versionId");
  if (!versionId.ok) return versionId;

  const source = resolveOptionalProjectVersionSource(input);
  if (!source.ok) return source;

  const createdAt = readOptionalRouteString(input, "createdAt", "created_at_invalid", "createdAt");
  if (!createdAt.ok) return createdAt;

  const label = readOptionalRouteString(input, "label", "label_invalid", "label");
  if (!label.ok) return label;

  const reason = readOptionalRouteString(input, "reason", "reason_invalid", "reason");
  if (!reason.ok) return reason;

  return {
    ok: true,
    value: {
      sourceOfTruth: sourceOfTruth.value,
      createdBy: createdBy.value,
      parentVersionId: baseVersionId.value,
      ...(versionId.value === undefined ? {} : { versionId: versionId.value }),
      ...(createdAt.value === undefined ? {} : { createdAt: createdAt.value }),
      ...(label.value === undefined ? {} : { label: label.value }),
      ...(reason.value === undefined ? {} : { reason: reason.value }),
      ...(source.value === undefined ? {} : { source: source.value }),
    },
  };
}

function resolveProposalProjectSourceOfTruth(
  input: Readonly<Record<string, unknown>>,
  defaults?: ProposalProjectSourceDefaults,
): RouteValueResult<ProposalProjectSourceOfTruth> {
  if (Object.hasOwn(input, "sourceOfTruth")) {
    return validateProposalProjectSourceOfTruth(input.sourceOfTruth, "sourceOfTruth");
  }

  const proposal = resolveProposalDocument(input);
  if (!proposal.ok) return proposal;

  const vendorBrand = resolveProjectVendorBrand(input, defaults?.vendorBrand);
  if (!vendorBrand.ok) return vendorBrand;

  const clientBrand = resolveClientBrand(
    input,
    proposal.value.draft.preparedFor,
    defaults?.clientBrand,
  );
  if (!clientBrand.ok) return clientBrand;

  return {
    ok: true,
    value: {
      draft: proposal.value.draft,
      vendorBrand: vendorBrand.value,
      clientBrand: clientBrand.value,
    },
  };
}

function validateProposalProjectSourceOfTruth(
  input: unknown,
  path: string,
): RouteValueResult<ProposalProjectSourceOfTruth> {
  if (!isRecord(input)) {
    return routeFailure(
      failureResponse(
        400,
        "source_of_truth_invalid",
        "sourceOfTruth must be an object with draft, vendorBrand, and clientBrand.",
      ),
    );
  }

  const errors: ProposalValidationError[] = [];
  let draft: ProposalDraft | null = null;
  let vendorBrand: ProposalBrand | null = null;
  let clientBrand: ProposalBrand | null = null;

  const draftResult = validateProposalDraft(input.draft);
  if (draftResult.ok) {
    draft = draftResult.value;
  } else {
    appendNestedValidationErrors(errors, `${path}.draft`, draftResult.errors);
  }

  const vendorBrandResult = validateProposalBrand(input.vendorBrand);
  if (vendorBrandResult.ok) {
    vendorBrand = vendorBrandResult.value;
  } else {
    appendNestedValidationErrors(errors, `${path}.vendorBrand`, vendorBrandResult.errors);
  }

  const clientBrandResult = validateProposalBrand(input.clientBrand);
  if (clientBrandResult.ok) {
    clientBrand = clientBrandResult.value;
  } else {
    appendNestedValidationErrors(errors, `${path}.clientBrand`, clientBrandResult.errors);
  }

  if (errors.length > 0) {
    return routeFailure(
      validationFailureResponse("Proposal project source of truth is invalid.", errors),
    );
  }
  if (draft === null || vendorBrand === null || clientBrand === null) {
    return routeFailure(
      failureResponse(422, "validation_failed", "Proposal project source of truth is invalid."),
    );
  }

  return { ok: true, value: { draft, vendorBrand, clientBrand } };
}

function resolveProjectVendorBrand(
  input: Readonly<Record<string, unknown>>,
  defaultBrand: ProposalBrand | undefined,
): RouteValueResult<ProposalBrand> {
  const rawBrand = readOptionalUnknown(input, "brand") ?? readOptionalUnknown(input, "brandId");
  if (rawBrand === undefined) {
    return { ok: true, value: defaultBrand ?? resolveBuiltInBrand(DEFAULT_BRAND_ID) };
  }

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

function resolveClientBrand(
  input: Readonly<Record<string, unknown>>,
  preparedFor: PreparedFor,
  defaultBrand: ProposalBrand | undefined,
): RouteValueResult<ProposalBrand> {
  const rawClientBrand =
    readOptionalUnknown(input, "clientBrand") ?? readOptionalUnknown(input, "clientBrandId");
  if (rawClientBrand === undefined) {
    return { ok: true, value: defaultBrand ?? deriveClientBrand(preparedFor) };
  }

  if (typeof rawClientBrand === "string") {
    const brand = resolveBrand(rawClientBrand);
    if (brand === null) {
      return routeFailure(
        failureResponse(
          400,
          "client_brand_unknown",
          "clientBrandId must be a built-in id or clientBrand must be a full brand profile.",
        ),
      );
    }
    return { ok: true, value: brand };
  }

  const result = validateProposalBrand(rawClientBrand);
  if (!result.ok) return validationFailureResult("Client brand profile is invalid.", result.errors);
  return { ok: true, value: result.value };
}

function deriveClientBrand(preparedFor: PreparedFor): ProposalBrand {
  const name = preparedFor.companyName;
  const accent = preparedFor.accentColor ?? "#2563eb";
  return {
    id: slugifyRouteIdentifier(name, "client"),
    name,
    legalName: name,
    ...(preparedFor.website === undefined ? {} : { website: preparedFor.website }),
    logoText: preparedFor.logoText ?? initialsForName(name),
    colors: {
      primary: "#0f172a",
      secondary: "#334155",
      accent,
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#111827",
      mutedText: "#64748b",
      border: "#dbe3ef",
    },
  } satisfies ProposalBrand;
}

function buildLatestProjectRenderBundle(
  version: ProposalProjectVersion,
  input: unknown,
): RouteValueResult<ProposalRenderBundle> {
  return buildProposalRenderBundle(buildLatestProjectRenderInput(version, input));
}

function buildLatestProjectRenderInput(
  version: ProposalProjectVersion,
  input: unknown,
): Readonly<Record<string, unknown>> {
  const requestInput = isRecord(input) ? input : {};
  return {
    ...requestInput,
    draft: version.sourceOfTruth.draft,
    brand: version.sourceOfTruth.vendorBrand,
  };
}

function resolveProposalProjectAuthor(
  input: Readonly<Record<string, unknown>>,
): RouteValueResult<ProposalAuthorMetadata> {
  const rawAuthor =
    readOptionalUnknown(input, "createdBy") ??
    readOptionalUnknown(input, "updatedBy") ??
    readOptionalUnknown(input, "author") ??
    readOptionalUnknown(input, "displayName") ??
    readOptionalUnknown(input, "authorDisplayName");
  if (rawAuthor === undefined || rawAuthor === null) {
    return { ok: true, value: DEFAULT_PROJECT_AUTHOR };
  }

  if (typeof rawAuthor === "string") {
    const displayName = rawAuthor.trim();
    if (displayName.length === 0) {
      return routeFailure(
        failureResponse(400, "author_invalid", "author must be a non-empty string when provided."),
      );
    }
    return {
      ok: true,
      value: createProposalAuthorMetadata({
        authorId: slugifyRouteIdentifier(displayName, "author"),
        displayName,
        kind: "human",
      }),
    };
  }

  if (!isRecord(rawAuthor)) {
    return routeFailure(
      failureResponse(
        400,
        "author_invalid",
        "createdBy must be author metadata or a display name.",
      ),
    );
  }

  const errors: string[] = [];
  const authorId = readRequiredAuthorString(rawAuthor, "authorId", errors);
  const displayName = readRequiredAuthorString(rawAuthor, "displayName", errors);
  const kind = readRequiredAuthorKind(rawAuthor.kind, errors);
  const email = readOptionalAuthorString(rawAuthor, "email", errors);
  const organization = readOptionalAuthorString(rawAuthor, "organization", errors);

  if (errors.length > 0 || authorId === null || displayName === null || kind === null) {
    return routeFailure(
      failureResponse(400, "author_invalid", "Author metadata is invalid.", errors),
    );
  }

  return {
    ok: true,
    value: createProposalAuthorMetadata({
      authorId,
      displayName,
      kind,
      ...(email === undefined ? {} : { email }),
      ...(organization === undefined ? {} : { organization }),
    }),
  };
}

function readRequiredAuthorString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  errors: string[],
): string | null {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key}: Must be a non-empty string.`);
    return null;
  }
  return value.trim();
}

function readOptionalAuthorString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  errors: string[],
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key}: Must be a non-empty string when provided.`);
    return undefined;
  }
  return value.trim();
}

function readRequiredAuthorKind(input: unknown, errors: string[]): ProposalAuthorKind | null {
  if (isProposalAuthorKind(input)) return input;
  errors.push(`kind: Must be one of: ${PROPOSAL_AUTHOR_KINDS.join(", ")}.`);
  return null;
}

function resolveRequiredBaseVersionId(
  input: Readonly<Record<string, unknown>>,
): RouteValueResult<ProposalProjectVersionId> {
  const rawBaseVersionId =
    readOptionalUnknown(input, "baseVersionId") ?? readOptionalUnknown(input, "baseVersion");
  if (typeof rawBaseVersionId !== "string" || rawBaseVersionId.trim().length === 0) {
    return routeFailure(
      failureResponse(
        400,
        "base_version_required",
        "baseVersionId must identify the latest version the update is based on.",
      ),
    );
  }
  return { ok: true, value: toProposalProjectVersionId(rawBaseVersionId.trim()) };
}

function resolveOptionalProjectId(
  input: Readonly<Record<string, unknown>>,
  key: string,
): RouteValueResult<ProposalProjectId | undefined> {
  const value = readOptionalRouteString(input, key, `${key}_invalid`, key);
  if (!value.ok) return value;
  return {
    ok: true,
    value: value.value === undefined ? undefined : toProposalProjectId(value.value),
  };
}

function resolveOptionalProjectVersionId(
  input: Readonly<Record<string, unknown>>,
  key: string,
): RouteValueResult<ProposalProjectVersionId | undefined> {
  const value = readOptionalRouteString(input, key, `${key}_invalid`, key);
  if (!value.ok) return value;
  return {
    ok: true,
    value: value.value === undefined ? undefined : toProposalProjectVersionId(value.value),
  };
}

function resolveOptionalProjectStatus(
  input: Readonly<Record<string, unknown>>,
): RouteValueResult<ProposalProjectStatus | undefined> {
  const rawStatus = readOptionalUnknown(input, "status");
  if (rawStatus === undefined) return { ok: true, value: undefined };
  if (isProposalProjectStatus(rawStatus)) return { ok: true, value: rawStatus };
  return routeFailure(
    failureResponse(
      400,
      "status_invalid",
      `status must be one of: ${PROPOSAL_PROJECT_STATUSES.join(", ")}.`,
    ),
  );
}

function resolveOptionalProjectVersionSource(
  input: Readonly<Record<string, unknown>>,
): RouteValueResult<ProposalProjectVersionSource | undefined> {
  const rawSource = readOptionalUnknown(input, "source");
  if (rawSource === undefined) return { ok: true, value: undefined };
  if (isProposalProjectVersionSource(rawSource)) return { ok: true, value: rawSource };
  return routeFailure(
    failureResponse(
      400,
      "source_invalid",
      `source must be one of: ${PROPOSAL_PROJECT_VERSION_SOURCES.join(", ")}.`,
    ),
  );
}

function readOptionalRouteString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
  label: string,
): RouteValueResult<string | undefined> {
  const rawValue = readOptionalUnknown(input, key);
  if (rawValue === undefined) return { ok: true, value: undefined };
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return routeFailure(failureResponse(400, code, `${label} must be a non-empty string.`));
  }
  return { ok: true, value: rawValue.trim() };
}

function currentProjectVersionResult(
  project: ProposalProject,
): RouteValueResult<ProposalProjectVersion> {
  const currentVersion = getCurrentProjectVersion(project);
  if (currentVersion !== null) return { ok: true, value: currentVersion };
  return routeFailure(
    failureResponse(
      500,
      "project_state_invalid",
      "Proposal project currentVersionId does not reference a stored version.",
      [`projectId: ${project.projectId}`, `currentVersionId: ${project.currentVersionId}`],
    ),
  );
}

function resolveRequiredProjectActionBaseVersion(
  input: unknown,
  project: ProposalProject,
  actionLabel: string,
): RouteValueResult<ProposalProjectVersionId> {
  if (!isRecord(input)) {
    return routeFailure(
      failureResponse(
        400,
        "base_version_required",
        `${actionLabel} request body must be a JSON object with baseVersionId.`,
      ),
    );
  }

  const baseVersionId = resolveRequiredBaseVersionId(input);
  if (!baseVersionId.ok) return baseVersionId;
  if (baseVersionId.value !== project.currentVersionId) {
    return routeFailure(
      projectVersionConflictResponse({
        providedBaseVersionId: baseVersionId.value,
        latestProject: projectConflictMetadata(project),
        retryInstruction: `Fetch the latest project state and retry ${actionLabel.toLowerCase()} against the current version.`,
      }),
    );
  }
  return { ok: true, value: baseVersionId.value };
}

interface ProjectVersionConflictResponseInput {
  readonly providedBaseVersionId: ProposalProjectVersionId;
  readonly latestProject: ProposalProjectConflictMetadata;
  readonly retryInstruction: string;
}

function projectVersionConflictResponse(
  input: ProjectVersionConflictResponseInput,
): ApiRouteResponse {
  const message = "Project has changed since the provided baseVersionId.";
  const details = projectVersionConflictDetails(input);
  logEvent("debug", "scopeforge.route.failure", {
    status: 409,
    code: "base_version_conflict",
    message,
    details,
    latestProject: input.latestProject,
  });
  return jsonResponse(409, {
    ok: false,
    error: {
      code: "base_version_conflict",
      message,
      details,
      latestProject: input.latestProject,
    },
    latestProject: input.latestProject,
  });
}

function projectVersionConflictDetails(
  input: ProjectVersionConflictResponseInput,
): readonly string[] {
  return [
    `providedBaseVersionId: ${input.providedBaseVersionId}`,
    `latest.currentVersionId: ${input.latestProject.currentVersionId}`,
    `latest.currentVersionNumber: ${input.latestProject.currentVersionNumber}`,
    `latest.updatedAt: ${input.latestProject.updatedAt}`,
    ...(input.latestProject.updatedBy === undefined
      ? []
      : [`latest.updatedBy: ${input.latestProject.updatedBy.displayName}`]),
    input.retryInstruction,
  ];
}

function proposalProjectNotFoundResponse(projectId: ProposalProjectId): ApiRouteResponse {
  return failureResponse(404, "project_not_found", `Proposal project was not found: ${projectId}.`);
}

function projectStoreWriteFailureResponse(code: string, error: unknown): ApiRouteResponse {
  logError(`scopeforge.route.${code}`, error);
  const message = error instanceof Error ? error.message : String(error);
  return failureResponse(500, code, "Proposal project storage write failed.", [message]);
}

function appendNestedValidationErrors(
  errors: ProposalValidationError[],
  prefix: string,
  nestedErrors: readonly ProposalValidationError[],
): void {
  for (const error of nestedErrors) {
    errors.push({ path: routeNestedPath(prefix, error.path), message: error.message });
  }
}

function routeNestedPath(parentPath: string, childPath: string): string {
  if (childPath === "$") return parentPath;
  return `${parentPath}.${childPath}`;
}

function methodNotAllowedResponse(allow: string, message: string): ApiRouteResponse {
  const response = failureResponse(405, "method_not_allowed", message, [`allow: ${allow}`]);
  return { ...response, headers: { ...response.headers, Allow: allow } };
}

function parseProposalProjectRoute(pathname: string): ProposalProjectRoute | null {
  const segments = pathname
    .slice(API_PREFIX.length)
    .split("/")
    .filter((segment) => segment.length > 0);
  const routeName = segments[0];
  if (routeName === undefined || !isProposalProjectRouteName(routeName)) return null;
  if (segments.length === 1) return { action: "collection" };

  const rawProjectId = segments[1];
  if (rawProjectId === undefined || rawProjectId.trim().length === 0) return null;
  const projectId = toProposalProjectId(decodeRouteSegment(rawProjectId) ?? rawProjectId);
  if (segments.length === 2) return { action: "state", projectId };

  const action = segments[2];
  if (action === undefined) return null;
  if (segments.length === 4 && action === "brands" && segments[3] === "import") {
    return { action: "importBrand", projectId };
  }
  if (segments.length !== 3) return null;
  switch (action) {
    case "versions":
      return { action: "versions", projectId };
    case "updates":
      return { action: "updates", projectId };
    case "preview":
      return { action: "preview", projectId };
    case "export":
    case "export-pdf":
      return { action: "exportPdf", projectId };
    default:
      return null;
  }
}

function isProposalProjectRouteName(input: string): boolean {
  return PROPOSAL_PROJECT_ROUTE_NAMES.some((routeName) => routeName === input);
}

function isProposalProjectStatus(input: unknown): input is ProposalProjectStatus {
  return typeof input === "string" && PROPOSAL_PROJECT_STATUSES.some((status) => status === input);
}

function isProposalProjectVersionSource(input: unknown): input is ProposalProjectVersionSource {
  return (
    typeof input === "string" && PROPOSAL_PROJECT_VERSION_SOURCES.some((source) => source === input)
  );
}

function isProposalAuthorKind(input: unknown): input is ProposalAuthorKind {
  return typeof input === "string" && PROPOSAL_AUTHOR_KINDS.some((kind) => kind === input);
}

function decodeRouteSegment(input: string): string | null {
  try {
    return decodeURIComponent(input);
  } catch {
    return null;
  }
}

function initialsForName(input: string): string {
  const initials = input
    .split(/\s+/)
    .map((part) => part[0])
    .filter((part): part is string => part !== undefined)
    .join("")
    .slice(0, 4)
    .toUpperCase();
  return initials.length === 0 ? "CL" : initials;
}

function slugifyRouteIdentifier(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? fallback : slug;
}

function healthResponse(agentSummary?: AgentConfigSummary): ApiRouteResponse {
  return jsonResponse(200, {
    ok: true,
    service: "scopeforge-app-server",
    apiVersion: 1,
    agent: agentSummary ?? { enabled: false },
    capabilities: [
      "proposal.validate",
      "proposal.analyze",
      "proposal.previewHtml",
      "proposal.exportPdf",
      "proposalProject.create",
      "proposalProject.list",
      "proposalProject.latestState",
      "proposalProject.versionHistory",
      "proposalProject.projectUpdates",
      "proposalProject.updateWithBaseVersion",
      "proposalProject.previewLatest",
      "proposalProject.exportLatestPdf",
      "proposalProject.importWebsiteBrand",
      "brand.listBuiltIns",
      "brand.validate",
      "brand.extractWebsite",
      "agent.messages",
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

async function extractBrandResponse(
  input: unknown,
  dependencies: AppRouteDependencies,
): Promise<ApiRouteResponse> {
  const request = resolveBrandExtractInput(input);
  if (!request.ok) return request.response;

  const extractor = dependencies.extractWebsiteBrand ?? extractWebsiteBrandFromUrl;
  try {
    const result = await extractor(
      request.value.url,
      buildWebsiteBrandExtractOptions(request.value, dependencies),
    );
    const brandResult = validateProposalBrand(result.proposalBrand);
    if (!brandResult.ok) {
      return validationFailureResponse("Extracted brand profile is invalid.", brandResult.errors);
    }

    return jsonResponse(200, {
      ok: true,
      brand: brandResult.value,
      source: result.source,
      sources: result.sources,
      meta: result.meta,
      palette: result.palette,
      assets: result.assets,
      favicons: result.favicons,
      logos: result.logos,
      ogImages: result.ogImages,
      colors: result.colors,
      ...(result.name === undefined ? {} : { name: result.name }),
      ...(result.tagline === undefined ? {} : { tagline: result.tagline }),
      ...(result.logoUrl === undefined ? {} : { logoUrl: result.logoUrl }),
      ...(result.manualOverrides === undefined ? {} : { manualOverrides: result.manualOverrides }),
    });
  } catch (error) {
    logError("scopeforge.route.brand_extract_failed", error, { url: request.value.url });
    return websiteBrandFailureResponse(error);
  }
}

function resolveBrandExtractInput(input: unknown): RouteValueResult<BrandExtractRouteInput> {
  if (!isRecord(input)) {
    return routeFailure(
      failureResponse(
        400,
        "brand_extract_request_invalid",
        "Brand extraction request body must be a JSON object with a url string.",
      ),
    );
  }

  const rawUrl = input.url;
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    return routeFailure(
      failureResponse(400, "brand_url_invalid", "url must be a non-empty website URL."),
    );
  }

  const manualOverrides = resolveWebsiteBrandManualOverrides(input);
  if (!manualOverrides.ok) return manualOverrides;

  const timeoutMs = readOptionalIntegerInRange(input, "timeoutMs", 500, MAX_BRAND_TIMEOUT_MS);
  if (!timeoutMs.ok) return timeoutMs;

  const maxBytes = readOptionalIntegerInRange(input, "maxBytes", 50_000, MAX_BRAND_BYTES);
  if (!maxBytes.ok) return maxBytes;

  const maxRedirects = readOptionalIntegerInRange(input, "maxRedirects", 0, MAX_BRAND_REDIRECTS);
  if (!maxRedirects.ok) return maxRedirects;

  return {
    ok: true,
    value: {
      url: rawUrl.trim(),
      ...(manualOverrides.value === undefined ? {} : { manualOverrides: manualOverrides.value }),
      ...(timeoutMs.value === undefined ? {} : { timeoutMs: timeoutMs.value }),
      ...(maxBytes.value === undefined ? {} : { maxBytes: maxBytes.value }),
      ...(maxRedirects.value === undefined ? {} : { maxRedirects: maxRedirects.value }),
    },
  };
}

function buildWebsiteBrandExtractOptions(
  request: BrandExtractRouteInput,
  dependencies: AppRouteDependencies,
): ExtractWebsiteBrandOptions {
  return {
    ...(request.manualOverrides === undefined ? {} : { manualOverrides: request.manualOverrides }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
    ...(request.maxRedirects === undefined ? {} : { maxRedirects: request.maxRedirects }),
    ...(dependencies.brandFetch === undefined ? {} : { fetchImpl: dependencies.brandFetch }),
    ...(dependencies.brandLookupHost === undefined
      ? {}
      : { lookupHost: dependencies.brandLookupHost }),
    ...(dependencies.brandNow === undefined ? {} : { now: dependencies.brandNow }),
  };
}

function resolveWebsiteBrandManualOverrides(
  input: Readonly<Record<string, unknown>>,
): RouteValueResult<WebsiteBrandManualOverrides | undefined> {
  const rawOverrides = input.manualOverrides;
  if (rawOverrides === undefined) return { ok: true, value: undefined };
  if (!isRecord(rawOverrides)) {
    return routeFailure(
      failureResponse(400, "brand_overrides_invalid", "manualOverrides must be an object."),
    );
  }

  const errors: string[] = [];
  const stringOverrides: Partial<Record<WebsiteBrandManualStringKey, string>> = {};
  for (const key of WEBSITE_BRAND_MANUAL_STRING_KEYS) {
    const value = rawOverrides[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`manualOverrides.${key}: Must be a non-empty string when provided.`);
      continue;
    }
    stringOverrides[key] = value.trim();
  }

  const colors = readWebsiteBrandManualColors(rawOverrides, errors);
  const notes = readWebsiteBrandManualNotes(rawOverrides, errors);
  if (errors.length > 0) {
    return routeFailure(
      failureResponse(
        400,
        "brand_overrides_invalid",
        "manualOverrides contains invalid fields.",
        errors,
      ),
    );
  }

  return {
    ok: true,
    value: {
      ...stringOverrides,
      ...(colors === undefined ? {} : { colors }),
      ...(notes === undefined ? {} : { notes }),
    },
  };
}

function readWebsiteBrandManualColors(
  input: Readonly<Record<string, unknown>>,
  errors: string[],
): Partial<ProposalBrandColors> | undefined {
  const rawColors = input.colors;
  if (rawColors === undefined) return undefined;
  if (!isRecord(rawColors)) {
    errors.push("manualOverrides.colors: Must be an object when provided.");
    return undefined;
  }

  const colors: Partial<Record<keyof ProposalBrandColors, string>> = {};
  for (const key of PROPOSAL_BRAND_COLOR_KEYS) {
    const value = rawColors[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`manualOverrides.colors.${key}: Must be a non-empty string when provided.`);
      continue;
    }
    colors[key] = value.trim();
  }

  return Object.keys(colors).length === 0 ? undefined : colors;
}

function readWebsiteBrandManualNotes(
  input: Readonly<Record<string, unknown>>,
  errors: string[],
): readonly string[] | undefined {
  const rawNotes = input.notes;
  if (rawNotes === undefined) return undefined;
  if (!Array.isArray(rawNotes)) {
    errors.push("manualOverrides.notes: Must be an array of strings when provided.");
    return undefined;
  }

  const notes: string[] = [];
  for (const [index, value] of rawNotes.entries()) {
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`manualOverrides.notes.${index}: Must be a non-empty string.`);
      continue;
    }
    notes.push(value.trim());
  }
  return notes.length === 0 ? undefined : notes;
}

function readOptionalIntegerInRange(
  input: Readonly<Record<string, unknown>>,
  key: string,
  min: number,
  max: number,
): RouteValueResult<number | undefined> {
  const rawValue = input[key];
  if (rawValue === undefined) return { ok: true, value: undefined };
  if (
    typeof rawValue !== "number" ||
    !Number.isInteger(rawValue) ||
    rawValue < min ||
    rawValue > max
  ) {
    return routeFailure(
      failureResponse(400, `${key}_invalid`, `${key} must be an integer from ${min} to ${max}.`),
    );
  }
  return { ok: true, value: rawValue };
}

function websiteBrandFailureResponse(error: unknown): ApiRouteResponse {
  if (error instanceof WebsiteBrandFetchError) {
    const details = websiteBrandFailureDetails(error);
    switch (error.code) {
      case "BAD_URL":
      case "BAD_SCHEME":
      case "BAD_HOSTNAME":
        return failureResponse(400, "brand_url_invalid", error.message, details);
      case "BLOCKED_ADDRESS":
        return failureResponse(400, "brand_url_blocked", error.message, details);
      case "BODY_TOO_LARGE":
        return failureResponse(413, "brand_response_too_large", error.message, details);
      case "TIMEOUT":
        return failureResponse(504, "brand_fetch_timeout", error.message, details);
      case "HTTP_ERROR":
      case "NON_HTML":
      case "TOO_MANY_REDIRECTS":
      case "REDIRECT_WITHOUT_LOCATION":
        return failureResponse(502, "brand_fetch_failed", error.message, details);
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return failureResponse(
    503,
    "brand_extract_failed",
    "Website brand extraction failed before a brand could be produced.",
    [message],
  );
}

function websiteBrandFailureDetails(error: WebsiteBrandFetchError): readonly string[] {
  return [
    `extractorCode: ${error.code}`,
    `url: ${error.url}`,
    ...(error.detail === undefined ? [] : [`detail: ${error.detail}`]),
  ];
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
    logError("scopeforge.route.pdf_render_failed", error, { format, fileName });
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
  logEvent(status >= 500 ? "warn" : "debug", "scopeforge.route.failure", {
    status,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
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
