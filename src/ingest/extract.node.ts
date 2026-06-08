import { extname } from "node:path";
import {
  DEFAULT_FILE_SOURCE_NAME,
  DEFAULT_PASTE_SOURCE_NAME,
  MAX_SOURCE_MATERIAL_FILE_BYTES,
  MAX_SOURCE_MATERIAL_TEXT_CHARS,
  SUPPORTED_SOURCE_MATERIAL_EXTENSIONS,
  SUPPORTED_SOURCE_MATERIAL_MEDIA_TYPES,
} from "./limits.js";
import { extractPdfText } from "./pdf.node.js";
import type {
  SourceMaterialError,
  SourceMaterialExtractionResult,
  SourceMaterialFileInput,
  SourceMaterialKind,
  SourceMaterialMetadata,
  SourceMaterialOrigin,
  SourceMaterialTextInput,
} from "./types.js";

interface ResolvedMaterialType {
  readonly kind: SourceMaterialKind;
  readonly mediaType: string;
  readonly extension: string;
}

interface JsonTextResult {
  readonly text: string;
  readonly warnings: readonly string[];
  readonly truncated: boolean;
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });
const DEFAULT_TEXT_MEDIA_TYPE = "text/plain; charset=utf-8";
const DEFAULT_JSON_MEDIA_TYPE = "application/json";
const DEFAULT_PDF_MEDIA_TYPE = "application/pdf";
const MAX_JSON_TRAVERSE_DEPTH = 8;
const MAX_JSON_LINES = 800;
const USEFUL_JSON_KEY =
  /client|company|account|buyer|sponsor|contact|meeting|notes?|summary|transcript|goal|objective|success|scope|requirement|deliverable|system|tool|workflow|pain|challenge|problem|role|team|headcount|pricing|price|budget|investment|value|saving|assumption|constraint|timeline|next/i;

export function extractSourceMaterialFromText(
  input: SourceMaterialTextInput,
): SourceMaterialExtractionResult {
  const sourceName = cleanSourceName(input.sourceName, DEFAULT_PASTE_SOURCE_NAME);
  const mediaType = normalizeMediaType(input.mediaType ?? DEFAULT_TEXT_MEDIA_TYPE);
  const sourceKind = input.sourceKind ?? (mediaType.includes("json") ? "json" : "text");
  const rawText = input.text;
  const byteLength = Buffer.byteLength(rawText, "utf8");
  const maxTextCharacters = input.maxTextCharacters ?? MAX_SOURCE_MATERIAL_TEXT_CHARS;

  if (rawText.trim().length === 0) {
    return extractionFailure({
      code: "source_material_empty",
      message: "Source material text is empty.",
    });
  }

  const parsed = sourceKind === "json" ? jsonTextFromRawText(rawText, maxTextCharacters) : null;
  if (parsed !== null && !parsed.ok) return parsed;

  const warnings = parsed?.document.warnings ?? [];
  const text = parsed?.document.text ?? normalizeExtractedText(rawText);
  const alreadyTruncated = parsed?.document.metadata.truncated === true;
  const limited = limitText(text, maxTextCharacters, warnings);
  if (limited.text.length === 0) {
    return extractionFailure({
      code: "source_material_empty",
      message: "Source material did not contain extractable text.",
    });
  }

  return extractionSuccess({
    text: limited.text,
    warnings: limited.warnings,
    metadata: {
      origin: input.origin ?? "paste",
      kind: sourceKind,
      sourceName,
      mediaType,
      byteLength,
      characterLength: limited.text.length,
      truncated: alreadyTruncated || limited.truncated,
    },
  });
}

export function extractSourceMaterialFromFile(
  input: SourceMaterialFileInput,
): SourceMaterialExtractionResult {
  const maxBytes = input.maxBytes ?? MAX_SOURCE_MATERIAL_FILE_BYTES;
  const maxTextCharacters = input.maxTextCharacters ?? MAX_SOURCE_MATERIAL_TEXT_CHARS;
  const bytes = Buffer.from(input.bytes);
  const sourceName = cleanSourceName(input.fileName, DEFAULT_FILE_SOURCE_NAME);

  if (bytes.byteLength === 0) {
    return extractionFailure({
      code: "source_material_empty",
      message: "Uploaded source material file is empty.",
    });
  }
  if (bytes.byteLength > maxBytes) {
    return extractionFailure({
      code: "source_material_too_large",
      message: `Source material files must be ${maxBytes} bytes or smaller.`,
      details: [`receivedBytes: ${bytes.byteLength}`],
    });
  }

  const resolved = resolveMaterialType({
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
    ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    ...(input.sourceKind === undefined ? {} : { sourceKind: input.sourceKind }),
    bytes,
  });
  if (!resolved.ok) return extractionFailure(resolved.error);

  switch (resolved.value.kind) {
    case "pdf":
      return extractPdfSource(bytes, sourceName, resolved.value, maxTextCharacters);
    case "json":
      return extractJsonSource(bytes, sourceName, resolved.value, maxTextCharacters);
    case "meeting_notes":
    case "transcript_summary":
    case "text":
      return extractTextSource(bytes, sourceName, resolved.value, maxTextCharacters);
  }
}

function extractPdfSource(
  bytes: Buffer,
  sourceName: string,
  resolved: ResolvedMaterialType,
  maxTextCharacters: number,
): SourceMaterialExtractionResult {
  if (!hasPdfHeader(bytes)) {
    return extractionFailure({
      code: "source_material_invalid",
      message: "The uploaded file was labeled as PDF but does not have a PDF header.",
    });
  }

  const pdf = extractPdfText(bytes, { maxTextCharacters });
  const text = normalizeExtractedText(pdf.text);
  if (text.length === 0) {
    return extractionFailure({
      code: "source_material_pdf_unreadable",
      message:
        "No selectable text could be extracted from this PDF. Paste an OCR transcript, meeting notes, or a text summary instead.",
      details: pdf.warnings,
    });
  }

  const limited = limitText(text, maxTextCharacters, pdf.warnings);
  return extractionSuccess({
    text: limited.text,
    warnings: limited.warnings,
    metadata: {
      origin: "upload",
      kind: "pdf",
      sourceName,
      mediaType: resolved.mediaType,
      byteLength: bytes.byteLength,
      characterLength: limited.text.length,
      truncated: limited.truncated,
    },
  });
}

function extractJsonSource(
  bytes: Buffer,
  sourceName: string,
  resolved: ResolvedMaterialType,
  maxTextCharacters: number,
): SourceMaterialExtractionResult {
  const rawText = decodeText(bytes);
  const parsed = jsonTextFromRawText(rawText, maxTextCharacters);
  if (!parsed.ok) return parsed;

  const limited = limitText(parsed.document.text, maxTextCharacters, parsed.document.warnings);
  return extractionSuccess({
    text: limited.text,
    warnings: limited.warnings,
    metadata: {
      origin: "upload",
      kind: "json",
      sourceName,
      mediaType: resolved.mediaType,
      byteLength: bytes.byteLength,
      characterLength: limited.text.length,
      truncated: parsed.document.metadata.truncated || limited.truncated,
    },
  });
}

function extractTextSource(
  bytes: Buffer,
  sourceName: string,
  resolved: ResolvedMaterialType,
  maxTextCharacters: number,
): SourceMaterialExtractionResult {
  if (looksBinary(bytes)) {
    return extractionFailure({
      code: "source_material_unsupported",
      message:
        "Uploaded source material appears to be binary. Upload text, JSON, or a selectable-text PDF.",
    });
  }

  const rawText = decodeText(bytes);
  const normalized = normalizeExtractedText(rawText);
  if (normalized.length === 0) {
    return extractionFailure({
      code: "source_material_empty",
      message: "Uploaded source material did not contain extractable text.",
    });
  }

  const limited = limitText(normalized, maxTextCharacters, []);
  return extractionSuccess({
    text: limited.text,
    warnings: limited.warnings,
    metadata: {
      origin: "upload",
      kind: resolved.kind,
      sourceName,
      mediaType: resolved.mediaType,
      byteLength: bytes.byteLength,
      characterLength: limited.text.length,
      truncated: limited.truncated,
    },
  });
}

function jsonTextFromRawText(
  rawText: string,
  maxTextCharacters: number,
): SourceMaterialExtractionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (error) {
    return extractionFailure({
      code: "source_material_invalid",
      message: "JSON source material could not be parsed.",
      details: [error instanceof Error ? error.message : String(error)],
    });
  }

  const jsonText = jsonToSourceText(parsed, maxTextCharacters);
  return extractionSuccess({
    text: jsonText.text,
    warnings: jsonText.warnings,
    metadata: {
      origin: "paste",
      kind: "json",
      sourceName: DEFAULT_PASTE_SOURCE_NAME,
      mediaType: DEFAULT_JSON_MEDIA_TYPE,
      byteLength: Buffer.byteLength(rawText, "utf8"),
      characterLength: jsonText.text.length,
      truncated: jsonText.truncated,
    },
  });
}

function jsonToSourceText(input: unknown, maxTextCharacters: number): JsonTextResult {
  const lines: string[] = [];
  const warnings: string[] = [];
  collectJsonLines(input, "$", 0, lines);

  const lineTruncated = lines.length >= MAX_JSON_LINES;
  let text = lines.slice(0, MAX_JSON_LINES).join("\n");
  if (lineTruncated) {
    warnings.push(`JSON source was limited to ${MAX_JSON_LINES} extracted lines.`);
  }

  if (text.trim().length === 0) {
    text = stableStringify(input);
    warnings.push(
      "JSON source did not contain obvious note fields; using a compact JSON rendering.",
    );
  }

  const limited = limitText(normalizeExtractedText(text), maxTextCharacters, warnings);
  return {
    text: limited.text,
    warnings: limited.warnings,
    truncated: lineTruncated || limited.truncated,
  };
}

function collectJsonLines(input: unknown, path: string, depth: number, lines: string[]): void {
  if (lines.length >= MAX_JSON_LINES || depth > MAX_JSON_TRAVERSE_DEPTH) return;

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length > 0 && (USEFUL_JSON_KEY.test(path) || trimmed.length > 25)) {
      lines.push(`${jsonPathLabel(path)}: ${trimmed}`);
    }
    return;
  }

  if (typeof input === "number" || typeof input === "boolean") {
    if (USEFUL_JSON_KEY.test(path)) lines.push(`${jsonPathLabel(path)}: ${String(input)}`);
    return;
  }

  if (Array.isArray(input)) {
    for (const [index, item] of input.entries()) {
      collectJsonLines(item, `${path}[${index}]`, depth + 1, lines);
      if (lines.length >= MAX_JSON_LINES) return;
    }
    return;
  }

  if (!isRecord(input)) return;
  const keys = Object.keys(input).sort((left, right) => left.localeCompare(right));
  for (const key of keys) {
    collectJsonLines(input[key], path === "$" ? key : `${path}.${key}`, depth + 1, lines);
    if (lines.length >= MAX_JSON_LINES) return;
  }
}

function stableStringify(input: unknown): string {
  return JSON.stringify(sortJson(input));
}

function sortJson(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortJson);
  if (!isRecord(input)) return input;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort((left, right) => left.localeCompare(right))) {
    output[key] = sortJson(input[key]);
  }
  return output;
}

function jsonPathLabel(path: string): string {
  return path.replace(/^\$\.?/, "");
}

function resolveMaterialType(input: {
  readonly fileName?: string;
  readonly mediaType?: string;
  readonly sourceKind?: SourceMaterialKind;
  readonly bytes: Buffer;
}):
  | { readonly ok: true; readonly value: ResolvedMaterialType }
  | { readonly ok: false; readonly error: SourceMaterialError } {
  const extension = fileExtension(input.fileName);
  const mediaType = normalizeMediaType(input.mediaType ?? mediaTypeFromExtension(extension));
  const inferredKind = kindFromMediaTypeOrExtension(mediaType, extension, input.bytes);
  const kind =
    inferredKind === "pdf" || inferredKind === "json"
      ? inferredKind
      : (input.sourceKind ?? inferredKind);

  if (kind === null) {
    return {
      ok: false,
      error: {
        code: "source_material_unsupported",
        message: "Unsupported source material type. Upload text, JSON, Markdown, CSV, or PDF.",
        details: [
          `mediaType: ${mediaType}`,
          `extension: ${extension.length === 0 ? "(none)" : extension}`,
        ],
      },
    };
  }

  if (
    !isSupportedMediaType(mediaType) &&
    extension.length > 0 &&
    !isSupportedExtension(extension)
  ) {
    return {
      ok: false,
      error: {
        code: "source_material_unsupported",
        message: "Unsupported source material type. Upload text, JSON, Markdown, CSV, or PDF.",
        details: [`mediaType: ${mediaType}`, `extension: ${extension}`],
      },
    };
  }

  return {
    ok: true,
    value: {
      kind,
      mediaType,
      extension,
    },
  };
}

function kindFromMediaTypeOrExtension(
  mediaType: string,
  extension: string,
  bytes: Buffer,
): SourceMaterialKind | null {
  if (mediaType.includes("pdf") || extension === ".pdf" || hasPdfHeader(bytes)) return "pdf";
  if (mediaType.includes("json") || extension === ".json") return "json";
  if (mediaType.startsWith("text/") || isSupportedExtension(extension)) return "text";
  if (mediaType === "application/octet-stream" && !looksBinary(bytes)) return "text";
  return null;
}

function mediaTypeFromExtension(extension: string): string {
  switch (extension) {
    case ".json":
      return DEFAULT_JSON_MEDIA_TYPE;
    case ".pdf":
      return DEFAULT_PDF_MEDIA_TYPE;
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    case ".log":
    case ".text":
    case ".txt":
      return DEFAULT_TEXT_MEDIA_TYPE;
    default:
      return "application/octet-stream";
  }
}

function normalizeMediaType(input: string): string {
  return input.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function fileExtension(fileName: string | undefined): string {
  if (fileName === undefined) return "";
  return extname(fileName).toLowerCase();
}

function cleanSourceName(input: string | undefined, fallback: string): string {
  if (input === undefined) return fallback;
  const leaf = input.split(/[\\/]+/).at(-1) ?? fallback;
  const cleaned = replaceControlCharacters(leaf).trim();
  return cleaned.length === 0 ? fallback : cleaned.slice(0, 160);
}

function limitText(
  input: string,
  maxCharacters: number,
  warnings: readonly string[],
): { readonly text: string; readonly warnings: readonly string[]; readonly truncated: boolean } {
  if (input.length <= maxCharacters) {
    return { text: input, warnings, truncated: false };
  }
  return {
    text: input.slice(0, maxCharacters).trim(),
    warnings: [...warnings, `Source material text was truncated to ${maxCharacters} characters.`],
    truncated: true,
  };
}

function decodeText(bytes: Buffer): string {
  return TEXT_DECODER.decode(bytes);
}

function normalizeExtractedText(input: string): string {
  return replaceControlCharacters(
    input
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n"),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function replaceControlCharacters(input: string): string {
  let output = "";
  for (const char of input) {
    const code = char.charCodeAt(0);
    output += (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127 ? " " : char;
  }
  return output;
}

function looksBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 4096));
  if (sample.includes(0)) return true;

  let suspicious = 0;
  for (const byte of sample) {
    const isTabOrNewline = byte === 9 || byte === 10 || byte === 13;
    const isControl = byte < 32 || byte === 127;
    if (isControl && !isTabOrNewline) suspicious += 1;
  }
  return sample.length > 0 && suspicious / sample.length > 0.08;
}

function hasPdfHeader(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

function isSupportedMediaType(mediaType: string): boolean {
  if (mediaType === "application/octet-stream") return true;
  return SUPPORTED_SOURCE_MATERIAL_MEDIA_TYPES.some((candidate) => candidate === mediaType);
}

function isSupportedExtension(extension: string): boolean {
  return SUPPORTED_SOURCE_MATERIAL_EXTENSIONS.some((candidate) => candidate === extension);
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

export function sourceMaterialKindLabel(kind: SourceMaterialKind): string {
  switch (kind) {
    case "meeting_notes":
      return "meeting notes";
    case "transcript_summary":
      return "transcript summary";
    case "text":
      return "text";
    case "json":
      return "JSON";
    case "pdf":
      return "PDF";
  }
}

export function isSourceMaterialKind(input: unknown): input is SourceMaterialKind {
  return (
    input === "meeting_notes" ||
    input === "transcript_summary" ||
    input === "text" ||
    input === "json" ||
    input === "pdf"
  );
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export type { SourceMaterialOrigin };
