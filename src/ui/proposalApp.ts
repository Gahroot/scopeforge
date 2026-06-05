import { analyzeProject } from "../core/index.js";
import { BUILT_IN_BRANDS, validateProposalBrand } from "../proposal/brands.js";
import {
  createProposalDraftStore,
  proposalIntakeToDraft,
  replaceCurrentDraft,
  undoDraft,
  type ProposalDraftStoreState,
} from "../proposal/draftStore.js";
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
import {
  type SavedProjectEntry,
  generateProjectId,
  loadLocalProjects,
  saveLocalProject,
  deleteLocalProject,
  type LocalProjectList,
} from "./localProjects.js";

/* ─── Types ─── */

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
  readonly projectsList: HTMLElement;
  readonly saveProjectButton: HTMLButtonElement;
  readonly timelineContainer: HTMLElement;
  readonly sectionsContainer: HTMLElement;
  readonly diffPanel: HTMLElement;
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

interface TimelineEntry {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly status: "running" | "done" | "error";
  readonly startedAt: number;
  readonly endedAt?: number;
}

type ProposalSectionKey =
  | "details"
  | "valueProposal"
  | "buildPlan"
  | "pricing"
  | "terms"
  | "nextSteps";

interface SectionRegenState {
  readonly sectionKey: ProposalSectionKey;
  readonly active: boolean;
  readonly originalDraft: ProposalDraft;
  readonly revisedDraft: ProposalDraft;
  readonly diff: readonly DiffLine[];
}

interface DiffLine {
  readonly kind: "added" | "removed" | "context";
  readonly text: string;
}

/* ─── Constants ─── */

const SECTION_META: Readonly<
  Record<ProposalSectionKey, { readonly label: string; readonly icon: string }>
> = {
  details: { label: "Executive Summary", icon: "📝" },
  valueProposal: { label: "Value Proposal", icon: "📈" },
  buildPlan: { label: "Build Plan", icon: "🔧" },
  pricing: { label: "Pricing", icon: "💰" },
  terms: { label: "Terms", icon: "📋" },
  nextSteps: { label: "Next Steps", icon: "🚀" },
};

/* ─── Entry point ─── */

export function createProposalApp(root: HTMLElement): void {
  root.innerHTML = appShell();

  const state = queryState(root);
  let currentPreview: PreviewResult | null = null;
  let customBrand: ProposalBrand | null = null;
  let previewTimer: number | null = null;
  let draftStore: ProposalDraftStoreState | null = null;
  let timeline: TimelineEntry[] = [];
  let regenState: SectionRegenState | null = null;
  let projects: LocalProjectList = loadLocalProjects();

  /* ── Timeline helpers ── */

  function pushTimeline(label: string, detail?: string): string {
    const id = `tl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entry: TimelineEntry = {
      id,
      label,
      detail: detail ?? "",
      status: "running",
      startedAt: performance.now(),
    };
    timeline = [...timeline, entry];
    renderTimeline(state.timelineContainer, timeline);
    return id;
  }

  function resolveTimeline(id: string, status: "done" | "error"): void {
    timeline = timeline.map((entry) =>
      entry.id === id ? { ...entry, status, endedAt: performance.now() } : entry,
    );
    renderTimeline(state.timelineContainer, timeline);
  }

  function clearTimeline(): void {
    timeline = [];
    renderTimeline(state.timelineContainer, timeline);
  }

  /* ── Projects ── */

  function renderProjects(): void {
    renderProjectList(state.projectsList, projects, {
      onLoad(id) {
        const entry = projects.find((p) => p.id === id);
        if (entry === undefined) return;
        state.textarea.value = entry.json;
        if (entry.brandId !== undefined) {
          state.brandSelect.value = entry.brandId;
        }
        currentPreview = preview(state, customBrand, { pushTimeline, resolveTimeline });
      },
      onDelete(id) {
        projects = deleteLocalProject(id);
        renderProjects();
      },
    });
  }

  state.saveProjectButton.addEventListener("click", () => {
    const raw = state.textarea.value.trim();
    if (raw.length === 0) {
      setStatus(state, "error", "No proposal JSON to save.");
      return;
    }
    const name = inferProjectName(raw);
    const entry: SavedProjectEntry = {
      id: generateProjectId(),
      name,
      savedAt: new Date().toISOString(),
      json: raw,
      kind: "intake",
      brandId: state.brandSelect.value,
      ...(currentPreview !== null ? { templateId: currentPreview.templateId } : {}),
    };
    projects = saveLocalProject(entry);
    renderProjects();
    setStatus(state, "success", `Saved "${name}" to local projects.`);
  });

  /* ── Brand panel ── */

  bindBrandPanel(state.brandPanel, {
    getPresetBrand: () => selectedEditorFallbackBrand(state.brandSelect.value, customBrand),
    onBrandApplied: (brand) => {
      customBrand = brand;
      state.brandSelect.value = "custom";
      const saveResult = saveBrandToCurrentInput(state, brand);
      if (saveResult.ok) {
        state.textarea.value = saveResult.json;
        currentPreview = preview(state, customBrand, { pushTimeline, resolveTimeline });
        return {
          ok: true,
          message: `Applied and saved ${brand.name} to the current proposal JSON.`,
          details: saveResult.details,
        } satisfies BrandApplyResult;
      }

      currentPreview = preview(state, customBrand, { pushTimeline, resolveTimeline });
      return {
        ok: false,
        message: `Applied ${brand.name} for this session, but could not save it to proposal JSON.`,
        details: [saveResult.message, ...saveResult.details],
      } satisfies BrandApplyResult;
    },
  });

  /* ── File input ── */

  state.fileInput.addEventListener("change", () => {
    void loadSelectedFile(state, customBrand, { pushTimeline, resolveTimeline }).then((result) => {
      currentPreview = result;
    });
  });

  /* ── Validate ── */

  state.validateButton.addEventListener("click", () => {
    clearTimeline();
    regenState = null;
    renderDiffPanel(state.diffPanel, null);
    currentPreview = preview(state, customBrand, { pushTimeline, resolveTimeline });
    if (currentPreview !== null) {
      draftStore = createProposalDraftStore(currentPreview.draft);
      renderSections(state.sectionsContainer, currentPreview.draft, handleSectionRegen);
    }
  });

  /* ── Textarea debounced preview ── */

  state.textarea.addEventListener("input", () => {
    currentPreview = null;
    draftStore = null;
    regenState = null;
    setPreviewButtons(state, false);
    clearTimeline();
    renderSections(state.sectionsContainer, null, handleSectionRegen);
    renderDiffPanel(state.diffPanel, null);
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      currentPreview = preview(state, customBrand, { pushTimeline, resolveTimeline });
      if (currentPreview !== null) {
        draftStore = createProposalDraftStore(currentPreview.draft);
        renderSections(state.sectionsContainer, currentPreview.draft, handleSectionRegen);
      }
      previewTimer = null;
    }, 500);
  });

  /* ── Selects ── */

  state.brandSelect.addEventListener("change", () => {
    currentPreview = preview(state, customBrand, { pushTimeline, resolveTimeline });
    if (currentPreview !== null) {
      draftStore = createProposalDraftStore(currentPreview.draft);
      renderSections(state.sectionsContainer, currentPreview.draft, handleSectionRegen);
    }
  });
  state.audienceSelect.addEventListener("change", () => {
    currentPreview = preview(state, customBrand, { pushTimeline, resolveTimeline });
  });
  state.templateSelect.addEventListener("change", () => {
    currentPreview = preview(state, customBrand, { pushTimeline, resolveTimeline });
  });

  /* ── Downloads ── */

  state.htmlDownloadButton.addEventListener("click", () => {
    const previewResult =
      currentPreview ?? preview(state, customBrand, { pushTimeline, resolveTimeline });
    if (previewResult === null) return;
    currentPreview = previewResult;
    downloadText(
      previewResult.html,
      "text/html;charset=utf-8",
      `${slugify(previewResult.intake.preparedFor.companyName)}-proposal.html`,
    );
    showExportSuccess(
      "HTML",
      `${slugify(previewResult.intake.preparedFor.companyName)}-proposal.html`,
    );
  });

  state.pdfDownloadButton.addEventListener("click", () => {
    const previewResult =
      currentPreview ?? preview(state, customBrand, { pushTimeline, resolveTimeline });
    if (previewResult === null) return;
    currentPreview = previewResult;
    void downloadPdf(state, previewResult, { pushTimeline, resolveTimeline });
  });

  state.printButton.addEventListener("click", () => {
    const printWindow = state.iframe.contentWindow;
    if (printWindow === null) return;
    printWindow.focus();
    printWindow.print();
  });

  /* ── Section regenerate handler ── */

  function handleSectionRegen(sectionKey: ProposalSectionKey): void {
    if (draftStore === null || currentPreview === null) return;

    const originalDraft = draftStore.current;
    const revisedDraft = simulateSectionRevision(originalDraft, sectionKey);
    const diff = computeDraftDiff(originalDraft, revisedDraft, sectionKey);

    if (diff.length === 0) {
      setStatus(state, "neutral", `No changes generated for ${SECTION_META[sectionKey].label}.`);
      return;
    }

    regenState = { sectionKey, active: true, originalDraft, revisedDraft, diff };
    draftStore = replaceCurrentDraft(draftStore, revisedDraft, {
      label: `Revised ${SECTION_META[sectionKey].label}`,
      source: "section-regen",
    });

    renderDiffPanel(state.diffPanel, regenState);
    setStatus(
      state,
      "neutral",
      `Draft revision ready for ${SECTION_META[sectionKey].label}. Approve or reject.`,
    );
  }

  /* ── Diff approve/reject ── (delegated from renderDiffPanel) */

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.dataset.action === "approve-diff") {
      if (regenState === null || draftStore === null) return;
      regenState = null;
      renderDiffPanel(state.diffPanel, null);
      currentPreview = rebuildPreview(state, draftStore.current, customBrand);
      if (currentPreview !== null) {
        state.textarea.value = JSON.stringify({ draft: draftStore.current }, null, 2);
        renderSections(state.sectionsContainer, draftStore.current, handleSectionRegen);
      }
      setStatus(state, "success", "Draft revision approved and applied.");
    }

    if (target.dataset.action === "reject-diff") {
      if (regenState === null || draftStore === null) return;
      draftStore = undoDraft(draftStore);
      regenState = null;
      renderDiffPanel(state.diffPanel, null);
      currentPreview = rebuildPreview(state, draftStore.current, customBrand);
      if (currentPreview !== null) {
        state.textarea.value = JSON.stringify({ draft: draftStore.current }, null, 2);
        renderSections(state.sectionsContainer, draftStore.current, handleSectionRegen);
      }
      setStatus(state, "neutral", "Draft revision rejected. Reverted to previous version.");
    }
  });

  /* ── Init ── */

  setEmptyPreview(state);
  renderProjects();
  renderSections(state.sectionsContainer, null, handleSectionRegen);
  renderTimeline(state.timelineContainer, []);
  renderDiffPanel(state.diffPanel, null);
}

/* ────────────────────────────────────────────
   Shell
   ──────────────────────────────────────────── */

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
          <button id="validate-button" type="button">Validate &amp; preview</button>
          <button id="save-project-button" type="button" class="secondary">💾 Save project</button>
          <button id="html-download-button" type="button" disabled>Download HTML</button>
          <button id="pdf-download-button" type="button" disabled>Download PDF</button>
          <button id="print-button" type="button" disabled>Print iframe</button>
        </div>

        <hr class="divider" />

        <div id="projects-container" class="projects-panel">
          <div class="projects-header">
            <span>Saved projects</span>
          </div>
          <div id="projects-list" class="projects-list"></div>
        </div>

        <hr class="divider" />

        <div id="status" class="status neutral">Waiting for proposal JSON.</div>
        <div id="diagnostics" class="diagnostics"></div>
      </aside>

      <section class="preview-panel">
        <div id="timeline-container"></div>

        <div id="sections-container" style="padding:0 0 8px;"></div>

        <div id="diff-panel"></div>

        <iframe id="proposal-preview" title="Proposal preview"></iframe>
      </section>
    </section>
  </main>`;
}

/* ────────────────────────────────────────────
   Query state
   ──────────────────────────────────────────── */

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
    projectsList: queryElement(root, "#projects-list", HTMLElement),
    saveProjectButton: queryElement(root, "#save-project-button", HTMLButtonElement),
    timelineContainer: queryElement(root, "#timeline-container", HTMLElement),
    sectionsContainer: queryElement(root, "#sections-container", HTMLElement),
    diffPanel: queryElement(root, "#diff-panel", HTMLElement),
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

/* ────────────────────────────────────────────
   Preview pipeline
   ──────────────────────────────────────────── */

interface TimelineHooks {
  readonly pushTimeline: (label: string, detail?: string) => string;
  readonly resolveTimeline: (id: string, status: "done" | "error") => void;
}

async function loadSelectedFile(
  state: ProposalAppState,
  customBrand: ProposalBrand | null,
  hooks: TimelineHooks,
): Promise<PreviewResult | null> {
  const file = state.fileInput.files?.[0];
  if (file === undefined) return null;
  state.textarea.value = await file.text();
  return preview(state, customBrand, hooks);
}

function preview(
  state: ProposalAppState,
  customBrand: ProposalBrand | null,
  hooks: TimelineHooks,
): PreviewResult | null {
  const raw = state.textarea.value.trim();
  if (raw.length === 0) {
    setEmptyPreview(state);
    return null;
  }

  // Parse
  const parseId = hooks.pushTimeline("Parse JSON", "Validating proposal structure");
  const parsed = parseJson(raw);
  if (!parsed.ok) {
    hooks.resolveTimeline(parseId, "error");
    setValidationFailure(state, "JSON parse failed.", [parsed.message]);
    return null;
  }
  hooks.resolveTimeline(parseId, "done");

  // Resolve input
  const templateId = selectedTemplateId(state.templateSelect.value);
  const inputResult = resolveProposalInput(parsed.value, templateId);
  if (!inputResult.ok) {
    setValidationFailure(state, inputResult.message, inputResult.details);
    return null;
  }

  // Analyze
  const analyzeId = hooks.pushTimeline(
    "Analyze economics",
    "Running three-lens cost/value/pricing model",
  );
  const analysis = analyzeProject(inputResult.intake.project);
  hooks.resolveTimeline(analyzeId, "done");

  // Guardrails
  const guardrailId = hooks.pushTimeline("Check guardrails", "Verifying methodology constraints");
  const audience = selectedAudience(state.audienceSelect.value);
  const blockingWarnings = getClientBlockingWarnings(analysis, { audience });
  if (blockingWarnings.length > 0) {
    hooks.resolveTimeline(guardrailId, "error");
    setValidationFailure(
      state,
      "Client proposal blocked by guardrail errors. Switch to internal audience for debugging or fix the economics.",
      blockingWarnings.map((warning) => `${warning.rule}: ${warning.message}`),
    );
    return null;
  }
  hooks.resolveTimeline(guardrailId, "done");

  // Brand
  const brandResult = resolveBrandSelection(parsed.value, state.brandSelect.value, customBrand);
  if (!brandResult.ok) {
    setValidationFailure(state, brandResult.message, brandResult.details);
    return null;
  }

  // Render
  const renderId = hooks.pushTimeline("Render HTML", "Building branded proposal markup");
  const html = renderValueProposalHtml(inputResult.draft, { brand: brandResult.brand, audience });
  hooks.resolveTimeline(renderId, "done");

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

function rebuildPreview(
  state: ProposalAppState,
  draft: ProposalDraft,
  customBrand: ProposalBrand | null,
): PreviewResult | null {
  const intake = proposalDraftToIntake(draft);
  const audience = selectedAudience(state.audienceSelect.value);
  const templateId = selectedTemplateId(state.templateSelect.value);

  const brandResult = resolveBrandSelection({}, state.brandSelect.value, customBrand);
  if (!brandResult.ok) return null;

  const analysis = analyzeProject(intake.project);
  const html = renderValueProposalHtml(draft, { brand: brandResult.brand, audience });

  state.iframe.srcdoc = html;
  setPreviewButtons(state, true);
  setSuccess(
    state,
    `Preview updated for ${intake.preparedFor.companyName}. Version ${draft.metadata.version}. ${analysis.warnings.length.toLocaleString("en-US")} guardrail note(s).`,
    analysis.warnings.map(
      (warning) => `${warning.severity.toUpperCase()} · ${warning.rule}: ${warning.message}`,
    ),
  );

  return {
    html,
    kind: "draft",
    draft,
    intake,
    templateId,
    brandRequest: brandResult.requestBrand,
    audience,
  };
}

/* ────────────────────────────────────────────
   Proposal input resolution
   ──────────────────────────────────────────── */

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

/* ────────────────────────────────────────────
   PDF download
   ──────────────────────────────────────────── */

async function downloadPdf(
  state: ProposalAppState,
  previewResult: PreviewResult,
  hooks: TimelineHooks,
): Promise<void> {
  const fileName = `${slugify(previewResult.intake.preparedFor.companyName)}-proposal.pdf`;
  const originalLabel = state.pdfDownloadButton.textContent ?? "Download PDF";
  state.pdfDownloadButton.disabled = true;
  state.pdfDownloadButton.textContent = "Rendering PDF…";
  setStatus(state, "loading", "Rendering PDF with local Playwright Chromium...");

  const tlId = hooks.pushTimeline("Export PDF", "Rendering via Playwright Chromium");

  try {
    const response = await fetch("/api/proposals/export-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPdfRequest(previewResult, fileName)),
    });

    if (!response.ok) {
      const apiError = await readApiError(response);
      hooks.resolveTimeline(tlId, "error");
      setPdfFailure(state, apiError.message, apiError.details);
      return;
    }

    const blob = await response.blob();
    downloadBlob(blob, fileNameFromResponse(response, fileName));
    hooks.resolveTimeline(tlId, "done");
    setSuccess(state, `PDF downloaded for ${previewResult.intake.preparedFor.companyName}.`, []);
    showExportSuccess("PDF", fileName);
  } catch (error) {
    hooks.resolveTimeline(tlId, "error");
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

/* ────────────────────────────────────────────
   Brand resolution
   ──────────────────────────────────────────── */

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

/* ────────────────────────────────────────────
   Status / preview helpers
   ──────────────────────────────────────────── */

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
  className: "neutral" | "success" | "error" | "loading",
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

/* ────────────────────────────────────────────
   Timeline rendering
   ──────────────────────────────────────────── */

function renderTimeline(container: HTMLElement, entries: readonly TimelineEntry[]): void {
  container.textContent = "";
  if (entries.length === 0) return;

  const header = document.createElement("div");
  header.className = "timeline-header";
  const title = document.createElement("span");
  title.textContent = "Processing timeline";
  header.appendChild(title);
  container.appendChild(header);

  const timeline = document.createElement("div");
  timeline.className = "timeline";

  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "timeline-item";

    const dot = document.createElement("span");
    dot.className = `timeline-dot ${entry.status}`;

    const content = document.createElement("div");
    content.className = "timeline-content";
    const label = document.createElement("div");
    label.className = "timeline-label";
    label.textContent = entry.label;
    content.appendChild(label);
    if (entry.detail !== undefined) {
      const detail = document.createElement("div");
      detail.className = "timeline-detail";
      detail.textContent = entry.detail;
      content.appendChild(detail);
    }

    const time = document.createElement("span");
    time.className = "timeline-time";
    if (entry.endedAt !== undefined) {
      const ms = Math.round(entry.endedAt - entry.startedAt);
      time.textContent = `${ms}ms`;
    } else {
      time.textContent = "…";
    }

    item.append(dot, content, time);
    timeline.appendChild(item);
  }

  container.appendChild(timeline);
}

/* ────────────────────────────────────────────
   Projects rendering
   ──────────────────────────────────────────── */

function renderProjectList(
  container: HTMLElement,
  projects: LocalProjectList,
  callbacks: { readonly onLoad: (id: string) => void; readonly onDelete: (id: string) => void },
): void {
  container.textContent = "";

  if (projects.length === 0) {
    const empty = document.createElement("div");
    empty.className = "projects-empty";
    empty.textContent = "No saved projects yet.";
    container.appendChild(empty);
    return;
  }

  for (const project of projects) {
    const item = document.createElement("div");
    item.className = "project-item";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-label", `Load project: ${project.name}`);

    const info = document.createElement("div");
    info.className = "project-info";
    const name = document.createElement("div");
    name.className = "project-name";
    name.textContent = project.name;
    const meta = document.createElement("div");
    meta.className = "project-meta";
    meta.textContent = `${formatRelativeTime(project.savedAt)} · ${project.kind}`;
    info.append(name, meta);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost project-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `Delete project: ${project.name}`);

    const load = (): void => callbacks.onLoad(project.id);
    const remove = (e: Event): void => {
      e.stopPropagation();
      callbacks.onDelete(project.id);
    };

    item.addEventListener("click", load);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        load();
      }
    });
    deleteBtn.addEventListener("click", remove);

    item.append(info, deleteBtn);
    container.appendChild(item);
  }
}

/* ────────────────────────────────────────────
   Section actions rendering
   ──────────────────────────────────────────── */

type SectionRegenHandler = (sectionKey: ProposalSectionKey) => void;

function renderSections(
  container: HTMLElement,
  draft: ProposalDraft | null,
  onRegen: SectionRegenHandler,
): void {
  container.textContent = "";
  if (draft === null) return;

  const header = document.createElement("div");
  header.className = "timeline-header";
  header.style.paddingBottom = "6px";
  const title = document.createElement("span");
  title.textContent = "Section actions";
  header.appendChild(title);
  container.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "section-actions";

  for (const key of Object.keys(SECTION_META) as readonly ProposalSectionKey[]) {
    const meta = SECTION_META[key];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "section-chip";
    chip.innerHTML = `<span class="section-chip-icon">${meta.icon}</span> Regen ${meta.label}`;
    chip.addEventListener("click", () => onRegen(key));
    actions.appendChild(chip);
  }

  container.appendChild(actions);
}

/* ────────────────────────────────────────────
   Diff panel rendering
   ──────────────────────────────────────────── */

function renderDiffPanel(container: HTMLElement, regen: SectionRegenState | null): void {
  container.textContent = "";
  if (regen === null) return;

  const panel = document.createElement("div");
  panel.className = "diff-panel";

  const header = document.createElement("div");
  header.className = "diff-header";
  const title = document.createElement("span");
  title.className = "diff-header-title";
  title.textContent = `Draft revision: ${SECTION_META[regen.sectionKey].label}`;
  const actions = document.createElement("div");
  actions.className = "diff-actions";

  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "success-btn";
  approveBtn.dataset.action = "approve-diff";
  approveBtn.textContent = "✓ Approve";

  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "danger-btn";
  rejectBtn.dataset.action = "reject-diff";
  rejectBtn.textContent = "✕ Reject";

  actions.append(approveBtn, rejectBtn);
  header.append(title, actions);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "diff-body";

  for (const line of regen.diff) {
    const div = document.createElement("div");
    div.className = `diff-line ${line.kind}`;
    const prefix = line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  ";
    div.textContent = `${prefix}${line.text}`;
    body.appendChild(div);
  }

  panel.appendChild(body);
  container.appendChild(panel);
}

/* ────────────────────────────────────────────
   Export success toast
   ──────────────────────────────────────────── */

function showExportSuccess(format: string, fileName: string): void {
  const existing = document.querySelector(".export-success");
  if (existing !== null) existing.remove();

  const toast = document.createElement("div");
  toast.className = "export-success";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  const icon = document.createElement("div");
  icon.className = "export-success-icon";
  icon.textContent = "✓";

  const body = document.createElement("div");
  body.className = "export-success-body";
  const titleDiv = document.createElement("div");
  titleDiv.className = "export-success-title";
  titleDiv.textContent = `${format} export complete`;
  const detailDiv = document.createElement("div");
  detailDiv.className = "export-success-detail";
  detailDiv.textContent = fileName;
  body.append(titleDiv, detailDiv);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ghost export-success-dismiss";
  dismiss.textContent = "Dismiss";

  const remove = (): void => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 300);
  };

  dismiss.addEventListener("click", remove);
  toast.append(icon, body, dismiss);
  document.body.appendChild(toast);

  setTimeout(remove, 6000);
}

/* ────────────────────────────────────────────
   Section revision simulation
   ──────────────────────────────────────────── */

function simulateSectionRevision(draft: ProposalDraft, key: ProposalSectionKey): ProposalDraft {
  switch (key) {
    case "details":
      return {
        ...draft,
        details: {
          ...draft.details,
          recommendation: `${draft.details.recommendation} (revised for clarity and impact)`,
          executiveSummary: [
            ...draft.details.executiveSummary,
            "This revision strengthens the value narrative with updated market positioning.",
          ],
        },
      };
    case "valueProposal":
      return {
        ...draft,
        valueProposal: {
          ...draft.valueProposal,
          headline: `${draft.valueProposal.headline} — updated`,
          narrative: `Revised analysis: ${draft.valueProposal.narrative ?? "Enhanced value narrative with deeper market context."}`,
          annualValueTarget: Math.round(draft.valueProposal.annualValueTarget * 1.05),
        },
      };
    case "buildPlan":
      return {
        ...draft,
        buildPlan: draft.buildPlan.map((step, index) =>
          index === 0
            ? {
                ...step,
                description: `${step.description} (revised: added early risk-mitigation checkpoint)`,
              }
            : step,
        ),
      };
    case "pricing":
      return {
        ...draft,
        pricing: {
          ...draft.pricing,
          summary: `${draft.pricing.summary} Revised to reflect updated scope alignment.`,
        },
      };
    case "terms":
      return {
        ...draft,
        terms: {
          ...draft.terms,
          paymentTerms: `${draft.terms.paymentTerms} Revised: 50% upon signing, 50% upon final delivery.`,
        },
      };
    case "nextSteps":
      return {
        ...draft,
        nextSteps: [
          ...draft.nextSteps,
          "Schedule a 30-minute alignment call within the next 5 business days.",
        ],
      };
  }
}

/* ────────────────────────────────────────────
   Diff computation (simple line-based)
   ──────────────────────────────────────────── */

function computeDraftDiff(
  original: ProposalDraft,
  revised: ProposalDraft,
  sectionKey: ProposalSectionKey,
): readonly DiffLine[] {
  const originalText = extractSectionText(original, sectionKey);
  const revisedText = extractSectionText(revised, sectionKey);

  if (originalText === revisedText) return [];

  const originalLines = originalText.split("\n");
  const revisedLines = revisedText.split("\n");

  const diff: DiffLine[] = [];
  const maxLen = Math.max(originalLines.length, revisedLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = originalLines[i];
    const revLine = revisedLines[i];

    if (origLine === undefined && revLine !== undefined) {
      diff.push({ kind: "added", text: revLine });
    } else if (origLine !== undefined && revLine === undefined) {
      diff.push({ kind: "removed", text: origLine });
    } else if (origLine !== undefined && revLine !== undefined) {
      if (origLine === revLine) {
        diff.push({ kind: "context", text: origLine });
      } else {
        diff.push({ kind: "removed", text: origLine });
        diff.push({ kind: "added", text: revLine });
      }
    }
  }

  return diff;
}

function extractSectionText(draft: ProposalDraft, key: ProposalSectionKey): string {
  switch (key) {
    case "details":
      return [
        `Recommendation: ${draft.details.recommendation}`,
        "Executive Summary:",
        ...draft.details.executiveSummary.map((s) => `  • ${s}`),
        ...(draft.details.investmentSummary !== undefined
          ? [`Investment: ${draft.details.investmentSummary}`]
          : []),
      ].join("\n");
    case "valueProposal":
      return [
        `Headline: ${draft.valueProposal.headline}`,
        `Narrative: ${draft.valueProposal.narrative ?? "(none)"}`,
        `Annual value target: ${draft.valueProposal.annualValueTarget}`,
        "Unlocks:",
        ...draft.valueProposal.unlocks.map((s) => `  • ${s}`),
      ].join("\n");
    case "buildPlan":
      return draft.buildPlan
        .map((step) => `${step.name} (${step.timing}): ${step.description}`)
        .join("\n");
    case "pricing":
      return [
        `Summary: ${draft.pricing.summary}`,
        "Phases:",
        ...draft.pricing.phases.map((phase) => {
          const price = phase.price === null ? "TBD" : `$${phase.price.toLocaleString("en-US")}`;
          return `  • ${phase.name}: ${price}`;
        }),
      ].join("\n");
    case "terms":
      return [
        `Payment: ${draft.terms.paymentTerms}`,
        "Assumptions:",
        ...draft.terms.assumptions.map((s) => `  • ${s}`),
        "Exclusions:",
        ...draft.terms.exclusions.map((s) => `  • ${s}`),
      ].join("\n");
    case "nextSteps":
      return ["Next Steps:", ...draft.nextSteps.map((s) => `  • ${s}`)].join("\n");
  }
}

/* ────────────────────────────────────────────
   Utilities
   ──────────────────────────────────────────── */

function inferProjectName(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const input = isRecord(parsed)
      ? ((parsed.draft as Readonly<Record<string, unknown>> | undefined) ??
        (parsed.intake as Readonly<Record<string, unknown>> | undefined) ??
        parsed)
      : parsed;
    if (isRecord(input)) {
      const preparedFor = input.preparedFor as Readonly<Record<string, unknown>> | undefined;
      if (
        isRecord(preparedFor) &&
        typeof preparedFor.companyName === "string" &&
        preparedFor.companyName.length > 0
      ) {
        return preparedFor.companyName;
      }
      const details = input.details as Readonly<Record<string, unknown>> | undefined;
      if (isRecord(details) && typeof details.title === "string" && details.title.length > 0) {
        return details.title;
      }
    }
  } catch {
    // fall through
  }
  return `Project ${new Date().toLocaleDateString("en-US")}`;
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
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
