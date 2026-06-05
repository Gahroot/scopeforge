import { validateProposalBrand } from "../proposal/brands.js";
import type {
  ProposalBrand,
  ProposalBrandColors,
  ProposalValidationError,
} from "../proposal/types.js";

const BRAND_COLOR_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text",
  "mutedText",
  "border",
] as const satisfies readonly (keyof ProposalBrandColors)[];

type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number];

const BRAND_COLOR_LABELS = {
  primary: "Primary",
  secondary: "Secondary",
  accent: "Accent",
  background: "Background",
  surface: "Surface",
  text: "Text",
  mutedText: "Muted text",
  border: "Border",
} satisfies Record<BrandColorKey, string>;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export interface BrandPanelState {
  readonly urlInput: HTMLInputElement;
  readonly extractButton: HTMLButtonElement;
  readonly loadJsonButton: HTMLButtonElement;
  readonly loadPresetButton: HTMLButtonElement;
  readonly applyButton: HTMLButtonElement;
  readonly downloadJsonButton: HTMLButtonElement;
  readonly manualJson: HTMLTextAreaElement;
  readonly status: HTMLElement;
  readonly preview: HTMLElement;
  readonly metadata: HTMLElement;
  readonly editor: BrandEditorState;
}

interface BrandEditorState {
  readonly id: HTMLInputElement;
  readonly name: HTMLInputElement;
  readonly legalName: HTMLInputElement;
  readonly tagline: HTMLInputElement;
  readonly website: HTMLInputElement;
  readonly email: HTMLInputElement;
  readonly phone: HTMLInputElement;
  readonly logoText: HTMLInputElement;
  readonly colors: readonly BrandColorInputPair[];
}

interface BrandColorInputPair {
  readonly key: BrandColorKey;
  readonly textInput: HTMLInputElement;
  readonly pickerInput: HTMLInputElement;
}

export type BrandApplyResult =
  | { readonly ok: true; readonly message: string; readonly details: readonly string[] }
  | { readonly ok: false; readonly message: string; readonly details: readonly string[] };

export interface BrandPanelCallbacks {
  readonly getPresetBrand: () => ProposalBrand;
  readonly onBrandApplied: (brand: ProposalBrand) => BrandApplyResult;
}

type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

type BrandReadResult =
  | { readonly ok: true; readonly brand: ProposalBrand }
  | { readonly ok: false; readonly details: readonly string[] };

interface ApiErrorSummary {
  readonly message: string;
  readonly details: readonly string[];
}

interface BrandExtractionMetadata {
  readonly requestedUrl: string | null;
  readonly normalizedUrl: string | null;
  readonly finalUrl: string | null;
  readonly fetchedAt: string | null;
  readonly statusCode: number | null;
  readonly bytesRead: number | null;
  readonly elapsedMs: number | null;
  readonly logoUrl: string | null;
  readonly warnings: readonly string[];
  readonly fieldSources: readonly string[];
  readonly colorCandidates: readonly BrandColorCandidateSummary[];
}

interface BrandColorCandidateSummary {
  readonly hex: string;
  readonly role: string;
  readonly source: string;
  readonly confidence: number | null;
}

type BrandExtractionReadResult =
  | { readonly ok: true; readonly brand: ProposalBrand; readonly metadata: BrandExtractionMetadata }
  | { readonly ok: false; readonly details: readonly string[] };

export function brandPanelShell(): string {
  const colorFields = BRAND_COLOR_KEYS.map(
    (key) => `<label class="brand-color-field">
      <span>${BRAND_COLOR_LABELS[key]}</span>
      <input id="brand-color-${key}-picker" type="color" value="#111827" aria-label="${BRAND_COLOR_LABELS[key]} picker" />
      <input id="brand-color-${key}" type="text" spellcheck="false" autocomplete="off" placeholder="#111827" />
    </label>`,
  ).join("");

  return `<details class="brand-panel" open>
    <summary>
      <span>Website brand extraction</span>
      <small class="brand-panel-kicker">Local Node API · editable before export</small>
    </summary>

    <div class="brand-panel-body">
      <label class="field">
        <span>Website URL</span>
        <input id="brand-url" type="url" inputmode="url" placeholder="https://client.example" autocomplete="url" />
      </label>
      <button id="brand-extract-button" type="button">Extract from website</button>

      <div id="brand-status" class="brand-status neutral">Use a website, preset, or manual ProposalBrand JSON.</div>
      <div id="brand-preview" class="brand-preview" aria-live="polite"></div>

      <div class="brand-editor" aria-label="Editable brand profile">
        <div class="control-row">
          <label class="field">
            <span>Name</span>
            <input id="brand-name" type="text" autocomplete="organization" />
          </label>
          <label class="field">
            <span>Logo text</span>
            <input id="brand-logo-text" type="text" maxlength="8" />
          </label>
        </div>
        <label class="field">
          <span>Tagline</span>
          <input id="brand-tagline" type="text" />
        </label>
        <div class="control-row">
          <label class="field">
            <span>Website</span>
            <input id="brand-website" type="url" inputmode="url" />
          </label>
          <label class="field">
            <span>ID</span>
            <input id="brand-id" type="text" spellcheck="false" />
          </label>
        </div>
        <div class="control-row">
          <label class="field">
            <span>Legal name</span>
            <input id="brand-legal-name" type="text" />
          </label>
          <label class="field">
            <span>Email</span>
            <input id="brand-email" type="email" autocomplete="email" />
          </label>
        </div>
        <label class="field">
          <span>Phone</span>
          <input id="brand-phone" type="tel" autocomplete="tel" />
        </label>
        <fieldset class="brand-colors">
          <legend>Colors</legend>
          <div class="brand-color-grid">${colorFields}</div>
        </fieldset>
      </div>

      <label class="field">
        <span>Manual brand JSON fallback</span>
        <textarea id="brand-json" class="brand-json" spellcheck="false" placeholder="Paste a ProposalBrand JSON object here..."></textarea>
      </label>
      <div class="brand-button-row">
        <button id="brand-load-json-button" type="button">Load JSON</button>
        <button id="brand-load-preset-button" type="button">Load preset</button>
        <button id="brand-apply-button" type="button">Apply & save brand</button>
        <button id="brand-download-json-button" type="button">Download JSON</button>
      </div>

      <div id="brand-metadata" class="brand-metadata">No website source metadata yet.</div>
    </div>
  </details>`;
}

export function queryBrandPanel(root: ParentNode): BrandPanelState {
  return {
    urlInput: queryElement(root, "#brand-url", HTMLInputElement),
    extractButton: queryElement(root, "#brand-extract-button", HTMLButtonElement),
    loadJsonButton: queryElement(root, "#brand-load-json-button", HTMLButtonElement),
    loadPresetButton: queryElement(root, "#brand-load-preset-button", HTMLButtonElement),
    applyButton: queryElement(root, "#brand-apply-button", HTMLButtonElement),
    downloadJsonButton: queryElement(root, "#brand-download-json-button", HTMLButtonElement),
    manualJson: queryElement(root, "#brand-json", HTMLTextAreaElement),
    status: queryElement(root, "#brand-status", HTMLElement),
    preview: queryElement(root, "#brand-preview", HTMLElement),
    metadata: queryElement(root, "#brand-metadata", HTMLElement),
    editor: {
      id: queryElement(root, "#brand-id", HTMLInputElement),
      name: queryElement(root, "#brand-name", HTMLInputElement),
      legalName: queryElement(root, "#brand-legal-name", HTMLInputElement),
      tagline: queryElement(root, "#brand-tagline", HTMLInputElement),
      website: queryElement(root, "#brand-website", HTMLInputElement),
      email: queryElement(root, "#brand-email", HTMLInputElement),
      phone: queryElement(root, "#brand-phone", HTMLInputElement),
      logoText: queryElement(root, "#brand-logo-text", HTMLInputElement),
      colors: queryBrandColorInputs(root),
    },
  };
}

export function bindBrandPanel(state: BrandPanelState, callbacks: BrandPanelCallbacks): void {
  let currentLogoUrl: string | null = null;
  let currentMetadata: BrandExtractionMetadata | null = null;

  const syncEditor = (): void => {
    const result = readBrandFromEditor(state);
    if (!result.ok) {
      state.applyButton.disabled = true;
      state.downloadJsonButton.disabled = true;
      setBrandStatus(
        state,
        "error",
        "Brand profile needs review before it can be applied.",
        result.details,
      );
      return;
    }

    state.applyButton.disabled = false;
    state.downloadJsonButton.disabled = false;
    state.manualJson.value = JSON.stringify(result.brand, null, 2);
    renderBrandPreview(state.preview, result.brand, currentLogoUrl);
  };

  for (const input of brandTextInputs(state.editor)) {
    input.addEventListener("input", syncEditor);
  }

  for (const color of state.editor.colors) {
    color.textInput.addEventListener("input", () => {
      syncPickerFromText(color);
      syncEditor();
    });
    color.pickerInput.addEventListener("input", () => {
      color.textInput.value = color.pickerInput.value;
      syncEditor();
    });
  }

  state.urlInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    state.extractButton.click();
  });

  state.extractButton.addEventListener("click", () => {
    void extractWebsiteBrand(state).then((result) => {
      if (!result.ok) {
        setBrandStatus(state, "error", "Website brand extraction failed.", result.details);
        return;
      }

      currentLogoUrl = result.metadata.logoUrl;
      currentMetadata = result.metadata;
      populateBrandEditor(state, result.brand, currentLogoUrl);
      renderBrandMetadata(state.metadata, currentMetadata);
      setBrandStatus(
        state,
        "success",
        `Extracted ${result.brand.name}. Review the editable fields, then apply & save.`,
        [],
      );
    });
  });

  state.loadJsonButton.addEventListener("click", () => {
    const parsed = parseJson(state.manualJson.value.trim());
    if (!parsed.ok) {
      setBrandStatus(state, "error", "Manual brand JSON could not be parsed.", [parsed.message]);
      return;
    }

    const validation = validateProposalBrand(parsed.value);
    if (!validation.ok) {
      setBrandStatus(
        state,
        "error",
        "Manual brand JSON is not a valid ProposalBrand.",
        validationErrors(validation.errors),
      );
      return;
    }

    currentLogoUrl = null;
    currentMetadata = null;
    populateBrandEditor(state, validation.value, currentLogoUrl);
    renderBrandMetadata(state.metadata, currentMetadata);
    setBrandStatus(state, "success", `Loaded manual brand JSON for ${validation.value.name}.`, []);
  });

  state.loadPresetButton.addEventListener("click", () => {
    const preset = callbacks.getPresetBrand();
    currentLogoUrl = null;
    currentMetadata = null;
    populateBrandEditor(state, preset, currentLogoUrl);
    renderBrandMetadata(state.metadata, currentMetadata);
    setBrandStatus(state, "neutral", `Loaded preset fallback: ${preset.name}.`, []);
  });

  state.applyButton.addEventListener("click", () => {
    const result = readBrandFromEditor(state);
    if (!result.ok) {
      setBrandStatus(
        state,
        "error",
        "Brand profile needs review before it can be applied.",
        result.details,
      );
      return;
    }

    const applyResult = callbacks.onBrandApplied(result.brand);
    setBrandStatus(
      state,
      applyResult.ok ? "success" : "error",
      applyResult.message,
      applyResult.details,
    );
  });

  state.downloadJsonButton.addEventListener("click", () => {
    const result = readBrandFromEditor(state);
    if (!result.ok) {
      setBrandStatus(state, "error", "Brand profile needs review before download.", result.details);
      return;
    }

    downloadText(
      JSON.stringify(result.brand, null, 2),
      "application/json;charset=utf-8",
      `${slugify(result.brand.name)}-brand.json`,
    );
    setBrandStatus(state, "success", `Downloaded brand JSON for ${result.brand.name}.`, []);
  });

  const preset = callbacks.getPresetBrand();
  populateBrandEditor(state, preset, null);
  renderBrandMetadata(state.metadata, null);
  setBrandStatus(state, "neutral", "Use a website, preset, or manual ProposalBrand JSON.", []);
}

function queryBrandColorInputs(root: ParentNode): readonly BrandColorInputPair[] {
  return BRAND_COLOR_KEYS.map((key) => ({
    key,
    textInput: queryElement(root, `#brand-color-${key}`, HTMLInputElement),
    pickerInput: queryElement(root, `#brand-color-${key}-picker`, HTMLInputElement),
  }));
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

async function extractWebsiteBrand(state: BrandPanelState): Promise<BrandExtractionReadResult> {
  const url = state.urlInput.value.trim();
  if (url.length === 0) {
    return { ok: false, details: ["Enter a public website URL before extracting a brand."] };
  }

  const originalLabel = state.extractButton.textContent ?? "Extract from website";
  state.extractButton.disabled = true;
  state.extractButton.textContent = "Extracting…";
  setBrandStatus(state, "neutral", "Fetching website through the local Node server...", []);

  try {
    const response = await fetch("/api/brand/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const apiError = await readBrandApiError(response);
      return { ok: false, details: [apiError.message, ...apiError.details] };
    }

    const json = (await response.json().catch(() => null)) as unknown;
    return readBrandExtractionResponse(json);
  } catch (error) {
    return {
      ok: false,
      details: [
        "Brand extraction API was not reachable. Start the local Node server with `npm run app:dev` and open http://127.0.0.1:4174.",
        formatError(error),
      ],
    };
  } finally {
    state.extractButton.disabled = false;
    state.extractButton.textContent = originalLabel;
  }
}

function readBrandExtractionResponse(input: unknown): BrandExtractionReadResult {
  if (!isRecord(input) || input.ok !== true) {
    return { ok: false, details: ["Brand extraction API returned an unexpected response."] };
  }

  const validation = validateProposalBrand(input.brand);
  if (!validation.ok) {
    return {
      ok: false,
      details: [
        "Extracted brand was not a valid ProposalBrand.",
        ...validationErrors(validation.errors),
      ],
    };
  }

  return {
    ok: true,
    brand: validation.value,
    metadata: readBrandExtractionMetadata(input),
  };
}

function readBrandExtractionMetadata(
  input: Readonly<Record<string, unknown>>,
): BrandExtractionMetadata {
  const source = isRecord(input.source) ? input.source : {};
  return {
    requestedUrl: readString(source, "requestedUrl"),
    normalizedUrl: readString(source, "normalizedUrl"),
    finalUrl: readString(source, "finalUrl"),
    fetchedAt: readString(source, "fetchedAt"),
    statusCode: readNumber(source, "statusCode"),
    bytesRead: readNumber(source, "bytesRead"),
    elapsedMs: readNumber(source, "elapsedMs"),
    logoUrl: readString(input, "logoUrl"),
    warnings: readStringArray(source.warnings),
    fieldSources: describeExtractionSources(input.sources),
    colorCandidates: readColorCandidates(input.colors),
  };
}

function describeExtractionSources(input: unknown): readonly string[] {
  if (!isRecord(input)) return [];

  const fieldSources = [
    describeFieldSource("Name", input.name),
    describeFieldSource("Tagline", input.tagline),
    describeFieldSource("Logo", input.logoUrl),
  ].filter(isString);

  const rawColors = input.colors;
  if (!isRecord(rawColors)) return fieldSources;

  const colorSources = BRAND_COLOR_KEYS.map((key) =>
    describeFieldSource(BRAND_COLOR_LABELS[key], rawColors[key]),
  ).filter(isString);

  return [...fieldSources, ...colorSources];
}

function describeFieldSource(label: string, input: unknown): string | null {
  if (!isRecord(input)) return null;

  const value = readString(input, "value") ?? "—";
  const source = readString(input, "source") ?? "unknown";
  const confidence = readNumber(input, "confidence");
  const confidenceText = confidence === null ? "" : ` · ${Math.round(confidence * 100)}%`;
  return `${label}: ${value} (${source}${confidenceText})`;
}

function readColorCandidates(input: unknown): readonly BrandColorCandidateSummary[] {
  if (!Array.isArray(input)) return [];

  const candidates: BrandColorCandidateSummary[] = [];
  for (const item of input) {
    if (!isRecord(item)) continue;
    const hex = readString(item, "hex");
    if (hex === null) continue;
    candidates.push({
      hex,
      role: readString(item, "role") ?? "supporting",
      source: readString(item, "source") ?? "unknown",
      confidence: readNumber(item, "confidence"),
    });
  }
  return candidates;
}

function populateBrandEditor(
  state: BrandPanelState,
  brand: ProposalBrand,
  logoUrl: string | null,
): void {
  state.editor.id.value = brand.id;
  state.editor.name.value = brand.name;
  state.editor.legalName.value = brand.legalName ?? "";
  state.editor.tagline.value = brand.tagline ?? "";
  state.editor.website.value = brand.website ?? "";
  state.editor.email.value = brand.email ?? "";
  state.editor.phone.value = brand.phone ?? "";
  state.editor.logoText.value = brand.logoText;

  for (const color of state.editor.colors) {
    const value = brand.colors[color.key];
    color.textInput.value = value;
    color.pickerInput.value = normalizePickerColor(value);
  }

  state.manualJson.value = JSON.stringify(brand, null, 2);
  state.applyButton.disabled = false;
  state.downloadJsonButton.disabled = false;
  renderBrandPreview(state.preview, brand, logoUrl);
}

function readBrandFromEditor(state: BrandPanelState): BrandReadResult {
  const name = state.editor.name.value.trim();
  const id = textOrFallback(
    state.editor.id.value,
    slugify(name.length === 0 ? "custom-brand" : name),
  );
  const logoText = textOrFallback(state.editor.logoText.value, initialsFor(name));
  const legalName = optionalString(state.editor.legalName.value);
  const tagline = optionalString(state.editor.tagline.value);
  const website = optionalString(state.editor.website.value);
  const email = optionalString(state.editor.email.value);
  const phone = optionalString(state.editor.phone.value);

  const candidate = {
    id,
    name,
    ...(legalName === undefined ? {} : { legalName }),
    ...(tagline === undefined ? {} : { tagline }),
    ...(website === undefined ? {} : { website }),
    ...(email === undefined ? {} : { email }),
    ...(phone === undefined ? {} : { phone }),
    logoText,
    colors: readBrandColors(state.editor.colors),
  } satisfies ProposalBrand;

  const validation = validateProposalBrand(candidate);
  if (!validation.ok) return { ok: false, details: validationErrors(validation.errors) };
  return { ok: true, brand: validation.value };
}

function readBrandColors(colors: readonly BrandColorInputPair[]): ProposalBrandColors {
  return {
    primary: readColorInput(colors, "primary"),
    secondary: readColorInput(colors, "secondary"),
    accent: readColorInput(colors, "accent"),
    background: readColorInput(colors, "background"),
    surface: readColorInput(colors, "surface"),
    text: readColorInput(colors, "text"),
    mutedText: readColorInput(colors, "mutedText"),
    border: readColorInput(colors, "border"),
  };
}

function readColorInput(colors: readonly BrandColorInputPair[], key: BrandColorKey): string {
  const color = colors.find((item) => item.key === key);
  return color?.textInput.value.trim() ?? "";
}

function brandTextInputs(editor: BrandEditorState): readonly HTMLInputElement[] {
  return [
    editor.id,
    editor.name,
    editor.legalName,
    editor.tagline,
    editor.website,
    editor.email,
    editor.phone,
    editor.logoText,
  ];
}

function syncPickerFromText(color: BrandColorInputPair): void {
  const value = color.textInput.value.trim();
  if (!HEX_COLOR_PATTERN.test(value)) return;
  color.pickerInput.value = value.toLowerCase();
}

function renderBrandPreview(
  container: HTMLElement,
  brand: ProposalBrand,
  logoUrl: string | null,
): void {
  container.textContent = "";

  const header = document.createElement("div");
  header.className = "brand-preview-header";

  const logo = document.createElement("div");
  logo.className = "brand-preview-logo";
  if (logoUrl !== null && isHttpUrl(logoUrl)) {
    const image = document.createElement("img");
    image.src = logoUrl;
    image.alt = `${brand.name} logo`;
    logo.appendChild(image);
  } else {
    logo.textContent = brand.logoText;
  }

  const copy = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = brand.name;
  copy.appendChild(name);
  const tagline = document.createElement("span");
  tagline.textContent = brand.tagline ?? "No tagline set";
  copy.appendChild(tagline);
  if (brand.website !== undefined) {
    const website = document.createElement("small");
    website.textContent = brand.website;
    copy.appendChild(website);
  }

  header.append(logo, copy);
  container.appendChild(header);

  const swatches = document.createElement("div");
  swatches.className = "brand-swatches";
  for (const key of BRAND_COLOR_KEYS) {
    const swatch = document.createElement("span");
    swatch.className = "brand-swatch";
    swatch.style.backgroundColor = brand.colors[key];
    swatch.title = `${BRAND_COLOR_LABELS[key]}: ${brand.colors[key]}`;
    swatches.appendChild(swatch);
  }
  container.appendChild(swatches);
}

function renderBrandMetadata(
  container: HTMLElement,
  metadata: BrandExtractionMetadata | null,
): void {
  container.textContent = "";
  if (metadata === null) {
    container.textContent = "No website source metadata yet.";
    return;
  }

  const list = document.createElement("dl");
  appendMetadataRow(list, "Requested", metadata.requestedUrl);
  appendMetadataRow(list, "Normalized", metadata.normalizedUrl);
  appendMetadataRow(list, "Final", metadata.finalUrl);
  appendMetadataRow(list, "Fetched", metadata.fetchedAt);
  appendMetadataRow(list, "Status", formatNullableNumber(metadata.statusCode));
  appendMetadataRow(list, "Bytes", formatNullableNumber(metadata.bytesRead));
  appendMetadataRow(
    list,
    "Elapsed",
    metadata.elapsedMs === null ? null : `${metadata.elapsedMs} ms`,
  );
  appendMetadataRow(list, "Logo URL", metadata.logoUrl);
  container.appendChild(list);

  if (metadata.fieldSources.length > 0) {
    appendMetadataList(container, "Field sources", metadata.fieldSources);
  }

  if (metadata.colorCandidates.length > 0) {
    appendMetadataList(
      container,
      "Color candidates",
      metadata.colorCandidates.slice(0, 10).map((color) => {
        const confidence =
          color.confidence === null ? "" : ` · ${Math.round(color.confidence * 100)}%`;
        return `${color.hex} · ${color.role} · ${color.source}${confidence}`;
      }),
    );
  }

  if (metadata.warnings.length > 0) {
    appendMetadataList(container, "Extractor warnings", metadata.warnings);
  }
}

function appendMetadataRow(list: HTMLElement, label: string, value: string | null): void {
  if (value === null || value.length === 0) return;
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}

function appendMetadataList(
  container: HTMLElement,
  label: string,
  values: readonly string[],
): void {
  const title = document.createElement("strong");
  title.textContent = label;
  const list = document.createElement("ul");
  for (const value of values) {
    const item = document.createElement("li");
    item.textContent = value;
    list.appendChild(item);
  }
  container.append(title, list);
}

function setBrandStatus(
  state: BrandPanelState,
  className: "neutral" | "success" | "error",
  message: string,
  details: readonly string[],
): void {
  state.status.className = `brand-status ${className}`;
  state.status.textContent = "";
  const text = document.createElement("span");
  text.textContent = message;
  state.status.appendChild(text);

  if (details.length === 0) return;
  const list = document.createElement("ul");
  for (const detail of details) {
    const item = document.createElement("li");
    item.textContent = detail;
    list.appendChild(item);
  }
  state.status.appendChild(list);
}

async function readBrandApiError(response: Response): Promise<ApiErrorSummary> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("application/json")) {
    const json = (await response.json().catch(() => null)) as unknown;
    const error = isRecord(json) && isRecord(json.error) ? json.error : null;
    if (error !== null) {
      const message =
        readString(error, "message") ?? `Brand extraction failed with ${response.status}.`;
      return { message, details: readStringArray(error.details) };
    }
  }

  const text = await response.text().catch(() => "");
  if (response.status === 404) {
    return {
      message:
        "Brand extraction API was not found. Start the local Node server with `npm run app:dev` and open http://127.0.0.1:4174 instead of the Vite-only URL.",
      details: text.trim().length === 0 ? [] : [text.trim()],
    };
  }

  return {
    message: `Brand extraction failed with HTTP ${response.status}.`,
    details: text.trim().length === 0 ? [] : [text.trim()],
  };
}

function parseJson(raw: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    return { ok: false, message: formatError(error) };
  }
}

function validationErrors(errors: readonly ProposalValidationError[]): readonly string[] {
  return errors.map((error) => `${error.path}: ${error.message}`);
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

function normalizePickerColor(input: string): string {
  return HEX_COLOR_PATTERN.test(input) ? input.toLowerCase() : "#111827";
}

function optionalString(input: string): string | undefined {
  const value = input.trim();
  return value.length === 0 ? undefined : value;
}

function textOrFallback(input: string, fallback: string): string {
  const value = input.trim();
  return value.length === 0 ? fallback : value;
}

function initialsFor(input: string): string {
  const words = input
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return "SF";

  const first = words[0]?.[0] ?? "S";
  const second = words.length > 1 ? (words[1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

function slugify(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length === 0 ? "custom-brand" : normalized;
}

function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatNullableNumber(input: number | null): string | null {
  return input === null ? null : input.toLocaleString("en-US");
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNumber(input: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(input: unknown): readonly string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isString(input: string | null): input is string {
  return input !== null;
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
