import type { ProposalProjectConflictMetadata } from "../../project/store.node.js";
import type {
  ProposalProject,
  ProposalProjectSourceOfTruth,
  ProposalProjectVersion,
} from "../../project/types.js";
import type { ProposalAudience, ProposalBrand, ProposalDraft } from "../../proposal/types.js";

export interface HealthAgentSummary {
  readonly enabled: boolean;
  readonly provider?: string;
  readonly model?: string;
}

export interface HealthResponse {
  readonly ok: boolean;
  readonly service: string;
  readonly apiVersion: number;
  readonly agent: HealthAgentSummary;
  readonly capabilities: readonly string[];
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
  } catch {
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
  const response = await fetch("/api/health", signal === undefined ? {} : { signal });
  return readJson<HealthResponse>(response);
}

export async function fetchBrands(signal?: AbortSignal): Promise<ApiResult<BrandsResponse>> {
  const response = await fetch("/api/brands", signal === undefined ? {} : { signal });
  return readJson<BrandsResponse>(response);
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

export interface ProjectBrandImportResponse extends BrandExtractResponse {
  readonly role: "vendor" | "client";
  readonly provenance: unknown;
  readonly project: ProposalProject;
  readonly currentVersion: ProposalProjectVersion;
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
}

export async function fetchProposalProjects(
  signal?: AbortSignal,
): Promise<ApiResult<ProposalProjectsResponse>> {
  const response = await fetch("/api/proposal-projects", signal === undefined ? {} : { signal });
  return readJson<ProposalProjectsResponse>(response);
}

export async function fetchProposalProjectState(
  projectId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ProposalProjectStateResponse>> {
  const response = await fetch(
    `/api/proposal-projects/${encodeURIComponent(projectId)}`,
    signal === undefined ? {} : { signal },
  );
  return readJson<ProposalProjectStateResponse>(response);
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

async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  return readJson<T>(response);
}

export interface PreviewResponse {
  readonly ok: boolean;
  readonly html: string;
  readonly audience: ProposalAudience;
}

export interface ProposalRequestBody {
  readonly draft: ProposalDraft;
  readonly brandId?: string;
  /** Full imported brand profile; takes precedence over `brandId` server-side. */
  readonly brand?: ProposalBrand;
  readonly audience?: ProposalAudience;
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
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    return readJson<never>(response) as Promise<ApiResult<ExportPdfResult>>;
  }

  const bytes = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const fileName = match?.[1] ?? "proposal.pdf";
  return { ok: true, value: { bytes, fileName } };
}
