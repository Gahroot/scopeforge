import { analyzeProject } from "../core/index.js";
import { BUILT_IN_BRANDS, validateProposalBrand } from "../proposal/brands.js";
import { proposalIntakeToDraft } from "../proposal/draftStore.js";
import {
  bindBrandPanel,
  brandPanelShell,
  queryBrandPanel,
  type BrandApplyResult,
  type BrandPanelState,
} from "./brandPanel.js";
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
import { renderValueProposalHtml } from "../render/valueProposalHtml.js";

interface ProposalAppState {
  readonly textarea: HTMLTextAreaElement;
  readonly fileInput: HTMLInputElement;
  readonly brandSelect: HTMLSelectElement;
  readonly audienceSelect: HTMLSelectElement;
  readonly templateSelect: HTMLSelectElement;
  readonly status: HTMLElement;
  readonly diagnostics: HTMLElement;
  readonly iframe: HTMLIFrameElement;
  readonly htmlDownloadButton: HTMLButtonElement;
  readonly pdfDownloadButton: HTMLButtonElement;
  readonly printButton: HTMLButtonElement;
  readonly validateButton: HTMLButtonElement;
  readonly brandPanel: BrandPanelState;
}

type BuiltInUiBrandId = "nolan" | "partners";
type UiBrandId = BuiltInUiBrandId | "custom";

interface PreviewResult {
  readonly html: string;
  readonly kind: "draft" | "intake";
  readonly draft: ProposalDraft;
  readonly intake: ProposalIntake;
  readonly templateId: ProposalDraftTemplateId;
  readonly brandRequest: BuiltInUiBrandId | ProposalBrand;
  readonly audience: ProposalAudience;
}

type ProposalInputResult =
  | {
      readonly ok: true;
      readonly kind: "draft" | "intake";
      readonly draft: ProposalDraft;
      readonly intake: ProposalIntake;
    }
  | { readonly ok: false; readonly message: string; readonly details: readonly string[] };

type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

type BrandSelectionResult =
  | {
      readonly ok: true;
      readonly brand: ProposalBrand;
      readonly requestBrand: BuiltInUiBrandId | ProposalBrand;
    }
  | { readonly ok: false; readonly message: string; readonly details: readonly string[] };

type BrandSaveResult =
  | { readonly ok: true; readonly json: string; readonly details: readonly string[] }
  | { readonly ok: false; readonly message: string; readonly details: readonly string[] };

type SavedBrandResult =
  | { readonly ok: true; readonly brand: ProposalBrand }
  | { readonly ok: false; readonly details: readonly string[] };

interface ApiErrorSummary {
  readonly message: string;
  readonly details: readonly string[];
}

export function createProposalApp(root: HTMLElement): void {
  root.innerHTML = appShell();

  const state = queryState(root);
  let currentPreview: PreviewResult | null = null;
  let customBrand: ProposalBrand | null = null;
  let previewTimer: number | null = null;

  bindBrandPanel(state.brandPanel, {
    getPresetBrand: () => selectedEditorFallbackBrand(state.brandSelect.value, customBrand),
    onBrandApplied: (brand) => {
      customBrand = brand;
      state.brandSelect.value = "custom";
      const saveResult = saveBrandToCurrentInput(state, brand);
      if (saveResult.ok) {
        state.textarea.value = saveResult.json;
        currentPreview = preview(state, customBrand);
        return {
          ok: true,
          message: `Applied and saved ${brand.name} to the current proposal JSON.`,
          details: saveResult.details,
        } satisfies BrandApplyResult;
      }

      currentPreview = preview(state, customBrand);
      return {
        ok: false,
        message: `Applied ${brand.name} for this session, but could not save it to proposal JSON.`,
        details: [saveResult.message, ...saveResult.details],
      } satisfies BrandApplyResult;
    },
  });

  state.fileInput.addEventListener("change", () => {
    void loadSelectedFile(state, customBrand).then((previewResult) => {
      currentPreview = previewResult;
    });
  });

  state.validateButton.addEventListener("click", () => {
    currentPreview = preview(state, customBrand);
  });

  state.textarea.addEventListener("input", () => {
    currentPreview = null;
    setPreviewButtons(state, false);
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      currentPreview = preview(state, customBrand);
      previewTimer = null;
    }, 500);
  });

  state.brandSelect.addEventListener("change", () => {
    currentPreview = preview(state, customBrand);
  });
  state.audienceSelect.addEventListener("change", () => {
    currentPreview = preview(state, customBrand);
  });
  state.templateSelect.addEventListener("change", () => {
    currentPreview = preview(state, customBrand);
  });

  state.htmlDownloadButton.addEventListener("click", () => {
    const previewResult = currentPreview ?? preview(state, customBrand);
    if (previewResult === null) return;
    currentPreview = previewResult;
    downloadText(
      previewResult.html,
      "text/html;charset=utf-8",
      `${slugify(previewResult.intake.preparedFor.companyName)}-proposal.html`,
    );
  });

  state.pdfDownloadButton.addEventListener("click", () => {
    const previewResult = currentPreview ?? preview(state, customBrand);
    if (previewResult === null) return;
    currentPreview = previewResult;
    void downloadPdf(state, previewResult);
  });

  state.printButton.addEventListener("click", () => {
    const printWindow = state.iframe.contentWindow;
    if (printWindow === null) return;
    printWindow.focus();
    printWindow.print();
  });

  setEmptyPreview(state);
}

function appShell(): string {
  return `<main class="app-shell">
    <section class="hero-panel">
      <div>
        <p class="eyebrow">ScopeForge proposal studio</p>
        <h1>Preview client-safe proposal HTML and export the final PDF locally.</h1>
        <p class="lede">Paste structured proposal intake or draft JSON, validate it, preview the branded proposal, then use the local Node server to render a Playwright PDF.</p>
      </div>
      <div class="hero-card">
        <strong>PDF export</strong>
        <span>Run <code>npm run app:dev</code> and open its URL before using Download PDF.</span>
      </div>
    </section>

    <section class="workspace">
      <aside class="controls-panel">
        <label class="field">
          <span>Proposal JSON</span>
          <input id="intake-file" type="file" accept="application/json,.json" />
        </label>

        <div class="control-row">
          <label class="field">
            <span>Brand</span>
            <select id="brand-select">
              <option value="nolan">Nolan</option>
              <option value="partners">Partners</option>
              <option value="custom">Custom / saved</option>
            </select>
          </label>
          <label class="field">
            <span>Audience</span>
            <select id="audience-select">
              <option value="client">Client</option>
              <option value="internal">Internal</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span>Template</span>
          <select id="template-select">
            <option value="generic/value-proposal">Value proposal</option>
            <option value="generic/scope-review">Scope review</option>
          </select>
        </label>

        ${brandPanelShell()}

        <textarea id="intake-text" spellcheck="false" placeholder="Paste ProposalIntake, ProposalDraft, { intake }, or { draft } JSON here..."></textarea>

        <div class="button-row">
          <button id="validate-button" type="button">Validate & preview</button>
          <button id="html-download-button" type="button" disabled>Download HTML</button>
          <button id="pdf-download-button" type="button" disabled>Download PDF</button>
          <button id="print-button" type="button" disabled>Print iframe</button>
        </div>

        <div id="status" class="status neutral">Waiting for proposal JSON.</div>
        <div id="diagnostics" class="diagnostics"></div>
      </aside>

      <section class="preview-panel">
        <iframe id="proposal-preview" title="Proposal preview"></iframe>
      </section>
    </section>
  </main>`;
}

function queryState(root: HTMLElement): ProposalAppState {
  return {
    textarea: queryElement(root, "#intake-text", HTMLTextAreaElement),
    fileInput: queryElement(root, "#intake-file", HTMLInputElement),
    brandSelect: queryElement(root, "#brand-select", HTMLSelectElement),
    audienceSelect: queryElement(root, "#audience-select", HTMLSelectElement),
    templateSelect: queryElement(root, "#template-select", HTMLSelectElement),
    status: queryElement(root, "#status", HTMLElement),
    diagnostics: queryElement(root, "#diagnostics", HTMLElement),
    iframe: queryElement(root, "#proposal-preview", HTMLIFrameElement),
    htmlDownloadButton: queryElement(root, "#html-download-button", HTMLButtonElement),
    pdfDownloadButton: queryElement(root, "#pdf-download-button", HTMLButtonElement),
    printButton: queryElement(root, "#print-button", HTMLButtonElement),
    validateButton: queryElement(root, "#validate-button", HTMLButtonElement),
    brandPanel: queryBrandPanel(root),
  };
}

function queryElement<T extends Element>(
  root: ParentNode,
  selector: string,
  elementType: { new (...args: never[]): T },
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof elementType)) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return element;
}

async function loadSelectedFile(
  state: ProposalAppState,
  customBrand: ProposalBrand | null,
): Promise<PreviewResult | null> {
  const file = state.fileInput.files?.[0];
  if (file === undefined) return null;
  state.textarea.value = await file.text();
  return preview(state, customBrand);
}

function preview(state: ProposalAppState, customBrand: ProposalBrand | null): PreviewResult | null {
  const raw = state.textarea.value.trim();
  if (raw.length === 0) {
    setEmptyPreview(state);
    return null;
  }

  const parsed = parseJson(raw);
  if (!parsed.ok) {
    setValidationFailure(state, "JSON parse failed.", [parsed.message]);
    return null;
  }

  const templateId = selectedTemplateId(state.templateSelect.value);
  const inputResult = resolveProposalInput(parsed.value, templateId);
  if (!inputResult.ok) {
    setValidationFailure(state, inputResult.message, inputResult.details);
    return null;
  }

  const brandResult = resolveBrandSelection(parsed.value, state.brandSelect.value, customBrand);
  if (!brandResult.ok) {
    setValidationFailure(state, brandResult.message, brandResult.details);
    return null;
  }

  const audience = selectedAudience(state.audienceSelect.value);
  const analysis = analyzeProject(inputResult.intake.project);
  const blockingWarnings = getClientBlockingWarnings(analysis, { audience });
  if (blockingWarnings.length > 0) {
    setValidationFailure(
      state,
      "Client proposal blocked by guardrail errors. Switch to internal audience for debugging or fix the economics.",
      blockingWarnings.map((warning) => `${warning.rule}: ${warning.message}`),
    );
    return null;
  }

  const html = renderValueProposalHtml(inputResult.draft, { brand: brandResult.brand, audience });
  state.iframe.srcdoc = html;
  setPreviewButtons(state, true);
  setSuccess(
    state,
    `Preview ready for ${inputResult.intake.preparedFor.companyName}. ${analysis.warnings.length.toLocaleString("en-US")} guardrail note(s).`,
    analysis.warnings.map(
      (warning) => `${warning.severity.toUpperCase()} · ${warning.rule}: ${warning.message}`,
    ),
  );

  return {
    html,
    kind: inputResult.kind,
    draft: inputResult.draft,
    intake: inputResult.intake,
    templateId,
    brandRequest: brandResult.requestBrand,
    audience,
  };
}

function resolveProposalInput(
  input: unknown,
  templateId: ProposalDraftTemplateId,
): ProposalInputResult {
  const candidate = unwrapProposalCandidate(input);
  if (candidate.kind === "draft") {
    const draftResult = validateProposalDraft(candidate.value);
    if (!draftResult.ok) {
      return validationInputFailure("Proposal draft is invalid.", draftResult.errors);
    }
    if (!draftResult.value.templateIds.some((id) => id === templateId)) {
      return {
        ok: false,
        message: "Selected template is not enabled for this draft.",
        details: [
          `Selected template: ${templateId}`,
          `Draft templateIds: ${draftResult.value.templateIds.join(", ")}`,
        ],
      };
    }

    return {
      ok: true,
      kind: "draft",
      draft: draftResult.value,
      intake: proposalDraftToIntake(draftResult.value),
    };
  }

  const intakeResult = validateProposalIntake(candidate.value);
  if (!intakeResult.ok) {
    return validationInputFailure(
      "Proposal intake is missing required client, scope, pricing, or value inputs.",
      intakeResult.errors,
    );
  }

  return {
    ok: true,
    kind: "intake",
    draft: proposalIntakeToDraft(intakeResult.value, { templateId }),
    intake: intakeResult.value,
  };
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

function looksLikeProposalDraft(input: unknown): boolean {
  return (
    isRecord(input) &&
    Array.isArray(input.templateIds) &&
    isRecord(input.metadata) &&
    isRecord(input.valueProposal) &&
    Array.isArray(input.buildPlan)
  );
}

function validationInputFailure(
  message: string,
  errors: readonly ProposalValidationError[],
): ProposalInputResult {
  return {
    ok: false,
    message,
    details: errors.map((error) => `${error.path}: ${error.message}`),
  };
}

async function downloadPdf(state: ProposalAppState, previewResult: PreviewResult): Promise<void> {
  const fileName = `${slugify(previewResult.intake.preparedFor.companyName)}-proposal.pdf`;
  const originalLabel = state.pdfDownloadButton.textContent ?? "Download PDF";
  state.pdfDownloadButton.disabled = true;
  state.pdfDownloadButton.textContent = "Rendering PDF…";
  setStatus(state, "neutral", "Rendering PDF with local Playwright Chromium...");

  try {
    const response = await fetch("/api/proposals/export-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPdfRequest(previewResult, fileName)),
    });

    if (!response.ok) {
      const apiError = await readApiError(response);
      setPdfFailure(state, apiError.message, apiError.details);
      return;
    }

    const blob = await response.blob();
    downloadBlob(blob, fileNameFromResponse(response, fileName));
    setSuccess(state, `PDF downloaded for ${previewResult.intake.preparedFor.companyName}.`, []);
  } catch (error) {
    setPdfFailure(
      state,
      "PDF export API was not reachable. Start the local Node server with `npm run app:dev` and open http://127.0.0.1:4174.",
      [formatError(error)],
    );
  } finally {
    state.pdfDownloadButton.textContent = originalLabel;
    setPreviewButtons(state, true);
  }
}

function buildPdfRequest(
  previewResult: PreviewResult,
  fileName: string,
): Readonly<Record<string, unknown>> {
  const documentPayload =
    previewResult.kind === "draft"
      ? { draft: previewResult.draft }
      : { intake: previewResult.intake };

  return {
    ...documentPayload,
    templateId: previewResult.templateId,
    brand: previewResult.brandRequest,
    audience: previewResult.audience,
    fileName,
  };
}

async function readApiError(response: Response): Promise<ApiErrorSummary> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    const json = (await response.json().catch(() => null)) as unknown;
    const error = isRecord(json) && isRecord(json.error) ? json.error : null;
    if (error !== null) {
      const code = readString(error, "code");
      const message = readString(error, "message") ?? `PDF export failed with ${response.status}.`;
      const details = readStringArray(error.details);
      if (code === "chromium_missing") {
        return {
          message:
            "Playwright Chromium is not installed. Run `npx playwright install chromium` from the project root, then try Download PDF again.",
          details: details.length === 0 ? [message] : details,
        };
      }
      return { message, details };
    }
  }

  const text = await response.text().catch(() => "");
  if (response.status === 404) {
    return {
      message:
        "PDF export API was not found. Start the local Node server with `npm run app:dev` and open http://127.0.0.1:4174 instead of the Vite-only URL.",
      details: text.trim().length === 0 ? [] : [text.trim()],
    };
  }

  return {
    message: `PDF export failed with HTTP ${response.status}.`,
    details: text.trim().length === 0 ? [] : [text.trim()],
  };
}

function resolveBrandSelection(
  input: unknown,
  selectedValue: string,
  customBrand: ProposalBrand | null,
): BrandSelectionResult {
  const brandId = selectedBrandId(selectedValue);
  if (brandId !== "custom") {
    return { ok: true, brand: selectedBrand(brandId), requestBrand: brandId };
  }

  if (customBrand !== null) {
    return { ok: true, brand: customBrand, requestBrand: customBrand };
  }

  const savedBrand = readSavedBrand(input);
  if (savedBrand.ok) {
    return { ok: true, brand: savedBrand.brand, requestBrand: savedBrand.brand };
  }

  return {
    ok: false,
    message: "Custom brand is selected, but no valid custom brand has been applied or saved.",
    details: savedBrand.details,
  };
}

function readSavedBrand(input: unknown): SavedBrandResult {
  if (!isRecord(input) || !Object.hasOwn(input, "brand")) {
    return {
      ok: false,
      details: [
        "Apply & save a custom brand, paste a ProposalBrand under top-level `brand`, or choose a preset.",
      ],
    };
  }

  const result = validateProposalBrand(input.brand);
  if (!result.ok) {
    return {
      ok: false,
      details: result.errors.map((error) => `brand.${error.path}: ${error.message}`),
    };
  }
  return { ok: true, brand: result.value };
}

function saveBrandToCurrentInput(state: ProposalAppState, brand: ProposalBrand): BrandSaveResult {
  const raw = state.textarea.value.trim();
  if (raw.length === 0) {
    return {
      ok: false,
      message: "No proposal JSON is loaded.",
      details: ["Paste or upload a proposal first, then apply & save the custom brand."],
    };
  }

  const parsed = parseJson(raw);
  if (!parsed.ok) {
    return { ok: false, message: "Proposal JSON could not be parsed.", details: [parsed.message] };
  }

  const templateId = selectedTemplateId(state.templateSelect.value);
  const inputResult = resolveProposalInput(parsed.value, templateId);
  if (!inputResult.ok) {
    return { ok: false, message: inputResult.message, details: inputResult.details };
  }

  return {
    ok: true,
    json: JSON.stringify(buildBrandedDraftEnvelope(parsed.value, inputResult, brand), null, 2),
    details: ["Saved as a top-level `brand` next to the validated proposal draft JSON."],
  };
}

function buildBrandedDraftEnvelope(
  input: unknown,
  proposal: Extract<ProposalInputResult, { readonly ok: true }>,
  brand: ProposalBrand,
): Readonly<Record<string, unknown>> {
  if (isRecord(input) && Object.hasOwn(input, "draft")) {
    return { ...input, draft: proposal.draft, brand };
  }

  if (isRecord(input) && Object.hasOwn(input, "intake")) {
    return { ...input, draft: proposal.draft, intake: proposal.intake, brand };
  }

  if (proposal.kind === "draft") return { draft: proposal.draft, brand };
  return { draft: proposal.draft, intake: proposal.intake, brand };
}

function selectedEditorFallbackBrand(
  input: string,
  customBrand: ProposalBrand | null,
): ProposalBrand {
  const brandId = selectedBrandId(input);
  if (brandId === "custom" && customBrand !== null) return customBrand;
  if (brandId === "custom") return BUILT_IN_BRANDS.nolan;
  return selectedBrand(brandId);
}

function selectedBrandId(input: string): UiBrandId {
  if (input === "partners") return "partners";
  if (input === "custom") return "custom";
  return "nolan";
}

function selectedBrand(input: BuiltInUiBrandId): ProposalBrand {
  return input === "partners" ? BUILT_IN_BRANDS.partners : BUILT_IN_BRANDS.nolan;
}

function selectedAudience(input: string): ProposalAudience {
  return input === "internal" ? "internal" : "client";
}

function selectedTemplateId(input: string): ProposalDraftTemplateId {
  for (const templateId of PROPOSAL_DRAFT_TEMPLATE_IDS) {
    if (templateId === input) return templateId;
  }
  return "generic/value-proposal";
}

function parseJson(raw: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    return { ok: false, message: formatError(error) };
  }
}

function setEmptyPreview(state: ProposalAppState): void {
  state.iframe.srcdoc = emptyPreviewHtml();
  setPreviewButtons(state, false);
  setStatus(state, "neutral", "Waiting for proposal JSON.");
  renderDiagnostics(state.diagnostics, []);
}

function setValidationFailure(
  state: ProposalAppState,
  message: string,
  details: readonly string[],
): void {
  setPreviewButtons(state, false);
  setStatus(state, "error", message);
  renderDiagnostics(state.diagnostics, details);
}

function setPdfFailure(state: ProposalAppState, message: string, details: readonly string[]): void {
  setPreviewButtons(state, true);
  setStatus(state, "error", message);
  renderDiagnostics(state.diagnostics, details);
}

function setSuccess(state: ProposalAppState, message: string, details: readonly string[]): void {
  setStatus(state, "success", message);
  renderDiagnostics(state.diagnostics, details);
}

function setPreviewButtons(state: ProposalAppState, enabled: boolean): void {
  state.htmlDownloadButton.disabled = !enabled;
  state.pdfDownloadButton.disabled = !enabled;
  state.printButton.disabled = !enabled;
}

function setStatus(
  state: ProposalAppState,
  className: "neutral" | "success" | "error",
  message: string,
): void {
  state.status.className = `status ${className}`;
  state.status.textContent = message;
}

function renderDiagnostics(container: HTMLElement, details: readonly string[]): void {
  container.textContent = "";
  if (details.length === 0) return;

  const list = document.createElement("ul");
  for (const detail of details) {
    const item = document.createElement("li");
    item.textContent = detail;
    list.appendChild(item);
  }
  container.appendChild(list);
}

function emptyPreviewHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
  <style>body{margin:0;display:grid;place-items:center;min-height:100vh;font-family:system-ui;background:#f8fafc;color:#64748b}.card{max-width:520px;padding:32px;border:1px solid #dbe3ef;border-radius:24px;background:#fff;text-align:center}strong{display:block;color:#111827;font-size:22px;margin-bottom:8px}</style>
  </head><body><div class="card"><strong>No preview yet</strong><span>Upload or paste proposal JSON, then validate.</span></div></body></html>`;
}

function downloadText(content: string, type: string, fileName: string): void {
  downloadBlob(new Blob([content], { type }), fileName);
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function fileNameFromResponse(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition");
  if (disposition === null) return fallback;

  const quoted = /filename="([^"]+)"/.exec(disposition);
  if (quoted?.[1] !== undefined) return quoted[1];

  const unquoted = /filename=([^;]+)/.exec(disposition);
  return unquoted?.[1]?.trim() ?? fallback;
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringArray(input: unknown): readonly string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function slugify(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length === 0 ? "scopeforge" : normalized;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
