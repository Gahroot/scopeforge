import type { ProposalProjectConflictMetadata } from "../../project/store.node.js";
import type {
  ProposalArtifactMetadata,
  ProposalProject,
  ProposalProjectSourceOfTruth,
  ProposalProjectVersion,
} from "../../project/types.js";
import type {
  ProposalDraftCandidate,
  SourceMaterialDocument,
  SourceMaterialKind,
} from "../../ingest/types.js";
import type { ProposalAudience, ProposalBrand, ProposalDraft } from "../../proposal/types.js";
import { addClientBreadcrumb, logClientError } from "./diagnostics.js";

export interface HealthAgentSummary {
  readonly enabled: boolean;
  readonly provider?: string;
  readonly model?: string;
  readonly accountId?: string;
}

export interface HealthResponse {
  readonly ok: boolean;
  readonly service: string;
  readonly apiVersion: number;
  readonly agent: HealthAgentSummary;
  readonly capabilities: readonly string[];
}

export interface AgentCredentialSummary {
  readonly provider: string;
  readonly configured: boolean;
  readonly authKind?: "api_key" | "oauth";
  readonly expiresAt?: number;
  readonly accountId?: string;
  readonly email?: string;
}

export interface AgentSettingsResponse {
  readonly ok: boolean;
  readonly providers: readonly { readonly provider: string; readonly label: string }[];
  readonly settings: { readonly provider: string; readonly model: string; readonly baseUrl?: string };
  readonly credentials: readonly AgentCredentialSummary[];
  readonly agent: HealthAgentSummary;
}

export interface AgentCredentialMutationResponse {
  readonly ok: boolean;
  readonly credentials: AgentCredentialSummary;
  readonly agent: HealthAgentSummary;
}

export interface AnthropicOAuthStartResponse {
  readonly ok: boolean;
  readonly authUrl: string;
  readonly state: string;
}

export interface OpenAIOAuthStartResponse {
  readonly ok: boolean;
  readonly authUrl: string;
  readonly state: string;
  readonly callbackUrl: string;
  readonly expiresAt: number;
}

export interface BrandsResponse {
  readonly ok: boolean;
  readonly brands: readonly ProposalBrand[];
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: readonly string[];
  readonly latestProject?: ProposalProjectConflictMetadata;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };

async function readJson<T>(response: Response): Promise<ApiResult<T>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    logClientError("scopeforge.client.invalid_json_response", error, {
      status: response.status,
      url: response.url,
    });
    return {
      ok: false,
      error: {
        code: "invalid_response",
        message: `Server returned non-JSON (${response.status}).`,
      },
    };
  }

  if (!response.ok) {
    const error = extractError(payload);
    addClientBreadcrumb("scopeforge.client.http_error", {
      status: response.status,
      url: response.url,
      code: error.code,
    });
    return { ok: false, error };
  }
  return { ok: true, value: payload as T };
}

function extractError(payload: unknown): ApiError {
  if (isRecord(payload) && isRecord(payload.error)) {
    const raw = payload.error;
    const latestProject = raw.latestProject;
    return {
      code: typeof raw.code === "string" ? raw.code : "request_failed",
      message: typeof raw.message === "string" ? raw.message : "Request failed.",
      ...(Array.isArray(raw.details)
        ? { details: raw.details.filter((d): d is string => typeof d === "string") }
        : {}),
      ...(isRecord(latestProject)
        ? { latestProject: latestProject as unknown as ProposalProjectConflictMetadata }
        : {}),
    };
  }
  return { code: "request_failed", message: "Request failed." };
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export async function fetchHealth(signal?: AbortSignal): Promise<ApiResult<HealthResponse>> {
  return getJson<HealthResponse>("/api/health", signal);
}

export async function fetchBrands(signal?: AbortSignal): Promise<ApiResult<BrandsResponse>> {
  return getJson<BrandsResponse>("/api/brands", signal);
}

export async function fetchAgentSettings(signal?: AbortSignal): Promise<ApiResult<AgentSettingsResponse>> {
  return getJson<AgentSettingsResponse>("/api/agent/settings", signal);
}

export async function updateAgentSettings(
  body: { readonly provider?: string; readonly model?: string; readonly baseUrl?: string },
  signal?: AbortSignal,
): Promise<ApiResult<AgentSettingsResponse>> {
  return patchJson<AgentSettingsResponse>("/api/agent/settings", body, signal);
}

export async function saveAgentApiKey(
  provider: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ApiResult<AgentCredentialMutationResponse>> {
  return postJson<AgentCredentialMutationResponse>("/api/agent/credentials/api-key", { provider, apiKey }, signal);
}

export async function clearAgentCredentials(
  provider: string,
  signal?: AbortSignal,
): Promise<ApiResult<AgentCredentialMutationResponse>> {
  return deleteJson<AgentCredentialMutationResponse>(`/api/agent/credentials/${encodeURIComponent(provider)}`, signal);
}

export async function startAnthropicOAuth(signal?: AbortSignal): Promise<ApiResult<AnthropicOAuthStartResponse>> {
  return postJson<AnthropicOAuthStartResponse>("/api/agent/oauth/anthropic/start", {}, signal);
}

export async function completeAnthropicOAuth(
  codeWithState: string,
  signal?: AbortSignal,
): Promise<ApiResult<AgentCredentialMutationResponse>> {
  return postJson<AgentCredentialMutationResponse>("/api/agent/oauth/anthropic/complete", { codeWithState }, signal);
}

export async function startOpenAIOAuth(signal?: AbortSignal): Promise<ApiResult<OpenAIOAuthStartResponse>> {
  return postJson<OpenAIOAuthStartResponse>("/api/agent/oauth/openai/start", {}, signal);
}

export async function refreshOpenAIOAuth(signal?: AbortSignal): Promise<ApiResult<AgentCredentialMutationResponse>> {
  return postJson<AgentCredentialMutationResponse>("/api/agent/oauth/openai/refresh", {}, signal);
}

export interface BrandExtractResponse {
  readonly ok: boolean;
  readonly brand: ProposalBrand;
  readonly source?: unknown;
  readonly sources?: unknown;
  readonly name?: string;
  readonly tagline?: string;
  readonly logoUrl?: string;
}

export async function extractBrand(
  url: string,
  signal?: AbortSignal,
): Promise<ApiResult<BrandExtractResponse>> {
  return postJson<BrandExtractResponse>("/api/brand/extract", { url }, signal);
}

export interface ProposalProjectListItemResponse {
  readonly projectId: string;
  readonly title: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentVersionId: string;
  readonly versionCount: number;
}

export interface ProposalProjectArtifactSummaryResponse {
  readonly artifactCount: number;
  readonly latestArtifact?: ProposalArtifactMetadata;
  readonly latestPdfArtifact?: ProposalArtifactMetadata;
  readonly latestPreviewArtifact?: ProposalArtifactMetadata;
}

export interface ProposalProjectsResponse {
  readonly ok: boolean;
  readonly projects: readonly ProposalProjectListItemResponse[];
}

export interface ProposalProjectStateResponse {
  readonly ok: boolean;
  readonly project: ProposalProject;
  readonly currentVersion: ProposalProjectVersion;
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
}

export type ProposalProjectVersionSummaryResponse = Pick<
  ProposalProjectVersion,
  "versionId" | "versionNumber" | "createdAt" | "createdBy" | "source" | "label" | "reason"
>;

export interface ProposalProjectUpdatesResponse {
  readonly ok: boolean;
  readonly projectId: string;
  readonly latestProject: ProposalProjectConflictMetadata;
  readonly latestVersion: ProposalProjectVersionSummaryResponse;
  readonly artifactSummary: ProposalProjectArtifactSummaryResponse;
}

export interface ProjectBrandImportResponse extends BrandExtractResponse {
  readonly role: "vendor" | "client";
  readonly provenance: unknown;
  readonly project: ProposalProject;
  readonly currentVersion: ProposalProjectVersion;
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
}

export interface CreateProposalProjectBody {
  readonly title: string;
  readonly clientName?: string;
  readonly displayName?: string;
}

export interface CreateProposalProjectResponse {
  readonly ok: boolean;
  readonly project: ProposalProject;
  readonly currentVersion: ProposalProjectVersion;
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
}

export async function fetchProposalProjects(
  signal?: AbortSignal,
): Promise<ApiResult<ProposalProjectsResponse>> {
  return getJson<ProposalProjectsResponse>("/api/proposal-projects", signal);
}

export async function fetchProposalProjectState(
  projectId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProposalProjectStateResponse>> {
  return getJson<ProposalProjectStateResponse>(
    `/api/proposal-projects/${encodeURIComponent(projectId)}`,
    signal,
  );
}

export async function fetchProposalProjectUpdates(
  projectId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProposalProjectUpdatesResponse>> {
  return getJson<ProposalProjectUpdatesResponse>(
    `/api/proposal-projects/${encodeURIComponent(projectId)}/updates`,
    signal,
  );
}

export async function createProposalProject(
  body: CreateProposalProjectBody,
  signal?: AbortSignal,
): Promise<ApiResult<CreateProposalProjectResponse>> {
  return postJson<CreateProposalProjectResponse>("/api/proposal-projects", body, signal);
}

export async function importProjectBrand(
  projectId: string,
  baseVersionId: string,
  role: "vendor" | "client",
  url: string,
  displayName: string | null,
  signal?: AbortSignal,
): Promise<ApiResult<ProjectBrandImportResponse>> {
  return postJson<ProjectBrandImportResponse>(
    `/api/proposal-projects/${encodeURIComponent(projectId)}/brands/import`,
    {
      role,
      url,
      baseVersionId,
      ...(displayName === null ? {} : { displayName }),
    },
    signal,
  );
}

export interface SourceMaterialFileBody {
  readonly name?: string;
  readonly mediaType?: string;
  readonly base64: string;
}

export interface SourceMaterialIngestBody {
  readonly sourceKind?: SourceMaterialKind;
  readonly sourceName?: string;
  readonly text?: string;
  readonly file?: SourceMaterialFileBody;
}

export interface SourceMaterialIngestResponse {
  readonly ok: boolean;
  readonly document: SourceMaterialDocument;
  readonly candidate: ProposalDraftCandidate;
  readonly limits: {
    readonly maxFileBytes: number;
    readonly maxBase64Characters: number;
    readonly maxTextCharacters: number;
  };
}

export async function ingestSourceMaterial(
  body: SourceMaterialIngestBody,
  signal?: AbortSignal,
): Promise<ApiResult<SourceMaterialIngestResponse>> {
  return postJson<SourceMaterialIngestResponse>("/api/source-material/ingest", body, signal);
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  addClientBreadcrumb("scopeforge.client.request_start", { method: "GET", path });
  try {
    const response = await fetch(path, signal === undefined ? {} : { signal });
    addClientBreadcrumb("scopeforge.client.response", { method: "GET", path, status: response.status });
    return readJson<T>(response);
  } catch (error) {
    logClientError("scopeforge.client.request_failed", error, { method: "GET", path });
    return networkFailure(error);
  }
}

async function patchJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  return methodJson<T>("PATCH", path, body, signal);
}

async function deleteJson<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  addClientBreadcrumb("scopeforge.client.request_start", { method: "DELETE", path });
  try {
    const response = await fetch(path, { method: "DELETE", ...(signal === undefined ? {} : { signal }) });
    addClientBreadcrumb("scopeforge.client.response", { method: "DELETE", path, status: response.status });
    return readJson<T>(response);
  } catch (error) {
    logClientError("scopeforge.client.request_failed", error, { method: "DELETE", path });
    return networkFailure(error);
  }
}

async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  return methodJson<T>("POST", path, body, signal);
}

async function methodJson<T>(
  method: "PATCH" | "POST",
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  addClientBreadcrumb("scopeforge.client.request_start", { method, path });
  try {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
    addClientBreadcrumb("scopeforge.client.response", { method, path, status: response.status });
    return readJson<T>(response);
  } catch (error) {
    logClientError("scopeforge.client.request_failed", error, { method, path });
    return networkFailure(error);
  }
}

function networkFailure<T>(error: unknown): ApiResult<T> {
  return {
    ok: false,
    error: {
      code: error instanceof DOMException && error.name === "AbortError" ? "aborted" : "network_error",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

export interface PreviewResponse {
  readonly ok: boolean;
  readonly html: string;
  readonly audience: ProposalAudience;
  readonly currentVersionId?: string;
  readonly artifact?: ProposalArtifactMetadata;
  readonly project?: ProposalProject;
}

export interface ProposalRequestBody {
  readonly draft: ProposalDraft;
  readonly brandId?: string;
  /** Full imported brand profile; takes precedence over `brandId` server-side. */
  readonly brand?: ProposalBrand;
  readonly audience?: ProposalAudience;
  readonly displayName?: string;
  /** Style preset ID to apply during rendering. */
  readonly stylePresetId?: string;
}

export async function previewProposal(
  body: ProposalRequestBody,
  signal?: AbortSignal,
): Promise<ApiResult<PreviewResponse>> {
  return postJson<PreviewResponse>("/api/proposals/preview", body, signal);
}

export interface ProjectProposalRequestBody extends ProposalRequestBody {
  readonly baseVersionId: string;
}

export async function previewProposalProject(
  projectId: string,
  body: ProjectProposalRequestBody,
  signal?: AbortSignal,
): Promise<ApiResult<PreviewResponse>> {
  return postJson<PreviewResponse>(
    `/api/proposal-projects/${encodeURIComponent(projectId)}/preview`,
    body,
    signal,
  );
}

export interface ExportPdfResult {
  readonly bytes: Blob;
  readonly fileName: string;
  readonly htmlArtifactId?: string;
  readonly htmlArtifactUri?: string;
  readonly pdfArtifactId?: string;
  readonly pdfArtifactUri?: string;
}

export async function exportProposalPdf(
  body: ProposalRequestBody,
  signal?: AbortSignal,
): Promise<ApiResult<ExportPdfResult>> {
  return exportPdfFromPath("/api/proposals/export-pdf", body, signal);
}

export async function exportProposalProjectPdf(
  projectId: string,
  body: ProjectProposalRequestBody,
  signal?: AbortSignal,
): Promise<ApiResult<ExportPdfResult>> {
  return exportPdfFromPath(
    `/api/proposal-projects/${encodeURIComponent(projectId)}/export-pdf`,
    body,
    signal,
  );
}

async function exportPdfFromPath(
  path: string,
  body: ProposalRequestBody | ProjectProposalRequestBody,
  signal?: AbortSignal,
): Promise<ApiResult<ExportPdfResult>> {
  addClientBreadcrumb("scopeforge.client.request_start", { method: "POST", path, kind: "pdf" });
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    logClientError("scopeforge.client.request_failed", error, { method: "POST", path, kind: "pdf" });
    return networkFailure(error);
  }
  addClientBreadcrumb("scopeforge.client.response", { method: "POST", path, status: response.status });

  if (!response.ok) {
    return readJson<never>(response) as Promise<ApiResult<ExportPdfResult>>;
  }

  const bytes = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const fileName = match?.[1] ?? "proposal.pdf";
  const htmlArtifactId = response.headers.get("X-ScopeForge-Html-Artifact-Id") ?? undefined;
  const htmlArtifactUri = response.headers.get("X-ScopeForge-Html-Artifact-Uri") ?? undefined;
  const pdfArtifactId = response.headers.get("X-ScopeForge-Pdf-Artifact-Id") ?? undefined;
  const pdfArtifactUri = response.headers.get("X-ScopeForge-Pdf-Artifact-Uri") ?? undefined;
  return {
    ok: true,
    value: {
      bytes,
      fileName,
      ...(htmlArtifactId === undefined ? {} : { htmlArtifactId }),
      ...(htmlArtifactUri === undefined ? {} : { htmlArtifactUri }),
      ...(pdfArtifactId === undefined ? {} : { pdfArtifactId }),
      ...(pdfArtifactUri === undefined ? {} : { pdfArtifactUri }),
    },
  };
}
