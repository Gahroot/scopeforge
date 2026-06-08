import { inflateSync } from "node:zlib";

export interface PdfTextExtractionOptions {
  readonly maxTextCharacters: number;
}

export interface PdfTextExtractionResult {
  readonly text: string;
  readonly warnings: readonly string[];
}

const PDF_HEADER = "%PDF-";
const MAX_STREAMS = 200;
const MAX_DECODED_STREAM_BYTES = 1_000_000;

/**
 * Best-effort PDF text extraction for PDFs that expose text in content streams.
 *
 * This intentionally does not pretend to be OCR: scanned/image-only PDFs and many
 * encrypted or highly encoded PDFs will return a warning instead of fabricated
 * text. Flate-compressed streams are supported because they are common in PDFs
 * produced by browser/office tooling and can be decoded with Node's built-in zlib.
 */
export function extractPdfText(
  bytes: Uint8Array,
  options: PdfTextExtractionOptions,
): PdfTextExtractionResult {
  const raw = Buffer.from(bytes).toString("latin1");
  const warnings: string[] = [];
  if (!raw.startsWith(PDF_HEADER)) {
    return {
      text: "",
      warnings: ["PDF extraction skipped because the file does not start with a %PDF header."],
    };
  }

  const chunks: string[] = [];
  let streamCount = 0;
  const streamPattern = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  for (const match of raw.matchAll(streamPattern)) {
    streamCount += 1;
    if (streamCount > MAX_STREAMS) {
      warnings.push(`PDF stream extraction stopped after ${MAX_STREAMS} streams.`);
      break;
    }

    const dictionary = match[1] ?? "";
    const streamBody = match[2] ?? "";
    const decoded = decodePdfStream(dictionary, streamBody);
    if (!decoded.ok) {
      warnings.push(decoded.warning);
      continue;
    }

    const streamText = extractTextFromPdfContent(decoded.value);
    if (streamText.length > 0) chunks.push(streamText);
    if (joinedLength(chunks) >= options.maxTextCharacters) break;
  }

  if (chunks.length === 0) {
    const fallback = extractTextFromPdfContent(raw);
    if (fallback.length > 0) chunks.push(fallback);
  }

  const text = normalizePdfWhitespace(chunks.join("\n"));
  if (text.length === 0) {
    warnings.push(
      "No selectable PDF text could be extracted. If this is a scanned PDF, paste an OCR transcript or meeting summary instead.",
    );
  }

  if (text.length > options.maxTextCharacters) {
    warnings.push(`Extracted PDF text was truncated to ${options.maxTextCharacters} characters.`);
    return { text: text.slice(0, options.maxTextCharacters), warnings };
  }

  return { text, warnings };
}

function decodePdfStream(
  dictionary: string,
  streamBody: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly warning: string } {
  const rawBytes = Buffer.from(trimStreamBoundary(streamBody), "latin1");
  if (/\/FlateDecode\b/.test(dictionary)) {
    try {
      return {
        ok: true,
        value: inflateSync(rawBytes, { maxOutputLength: MAX_DECODED_STREAM_BYTES }).toString(
          "latin1",
        ),
      };
    } catch (error) {
      return {
        ok: false,
        warning: `Could not inflate one PDF stream within ${MAX_DECODED_STREAM_BYTES} bytes: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (/\/Filter\b/.test(dictionary) && !/\/FlateDecode\b/.test(dictionary)) {
    return {
      ok: false,
      warning: "Skipped a PDF stream that uses an unsupported non-Flate filter.",
    };
  }

  return { ok: true, value: rawBytes.toString("latin1") };
}

function trimStreamBoundary(input: string): string {
  return input.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

function extractTextFromPdfContent(input: string): string {
  const chunks: string[] = [];

  const arrayTextPattern = /\[([\s\S]*?)\]\s*TJ/g;
  for (const match of input.matchAll(arrayTextPattern)) {
    const body = match[1] ?? "";
    const text = parsePdfStrings(body).join("");
    if (text.trim().length > 0) chunks.push(text);
  }

  const operatorTextPattern =
    /((?:\((?:\\.|[^\\()])*\)|<\s*[0-9A-Fa-f\s]+\s*>)(?:\s+(?:\((?:\\.|[^\\()])*\)|<\s*[0-9A-Fa-f\s]+\s*>))*)\s*(?:Tj|'|")/g;
  for (const match of input.matchAll(operatorTextPattern)) {
    const body = match[1] ?? "";
    const text = parsePdfStrings(body).join(" ");
    if (text.trim().length > 0) chunks.push(text);
  }

  return normalizePdfWhitespace(chunks.join("\n"));
}

function parsePdfStrings(input: string): readonly string[] {
  const values: string[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (char === "(") {
      const parsed = parseLiteralString(input, index);
      if (parsed !== null) {
        values.push(parsed.value);
        index = parsed.endIndex;
        continue;
      }
    }
    if (char === "<" && input[index + 1] !== "<") {
      const parsed = parseHexString(input, index);
      if (parsed !== null) {
        values.push(parsed.value);
        index = parsed.endIndex;
        continue;
      }
    }
    index += 1;
  }
  return values;
}

function parseLiteralString(
  input: string,
  startIndex: number,
): { readonly value: string; readonly endIndex: number } | null {
  let depth = 1;
  let index = startIndex + 1;
  let value = "";

  while (index < input.length) {
    const char = input[index];
    if (char === undefined) return null;

    if (char === "\\") {
      const next = input[index + 1];
      if (next === undefined) return null;
      const escaped = decodePdfEscape(next, input[index + 2]);
      value += escaped.value;
      index += escaped.consumed;
      continue;
    }

    if (char === "(") {
      depth += 1;
      value += char;
      index += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) return { value: decodePdfUtf16IfPresent(value), endIndex: index + 1 };
      value += char;
      index += 1;
      continue;
    }

    value += char;
    index += 1;
  }

  return null;
}

function decodePdfEscape(
  char: string,
  lookahead: string | undefined,
): { readonly value: string; readonly consumed: number } {
  switch (char) {
    case "n":
      return { value: "\n", consumed: 2 };
    case "r":
      return { value: "\r", consumed: 2 };
    case "t":
      return { value: "\t", consumed: 2 };
    case "b":
      return { value: "\b", consumed: 2 };
    case "f":
      return { value: "\f", consumed: 2 };
    case "(":
    case ")":
    case "\\":
      return { value: char, consumed: 2 };
    case "\r":
      return { value: "", consumed: lookahead === "\n" ? 3 : 2 };
    case "\n":
      return { value: "", consumed: 2 };
    default:
      return { value: char, consumed: 2 };
  }
}

function parseHexString(
  input: string,
  startIndex: number,
): { readonly value: string; readonly endIndex: number } | null {
  const endIndex = input.indexOf(">", startIndex + 1);
  if (endIndex < 0) return null;
  const hex = input
    .slice(startIndex + 1, endIndex)
    .replace(/\s+/g, "")
    .replace(/[^0-9A-Fa-f]/g, "");
  if (hex.length === 0) return { value: "", endIndex: endIndex + 1 };
  const padded = hex.length % 2 === 0 ? hex : `${hex}0`;
  const bytes = Buffer.from(padded, "hex");
  return { value: decodePdfStringBytes(bytes), endIndex: endIndex + 1 };
}

function decodePdfStringBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let value = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      value += String.fromCharCode((bytes[index] ?? 0) * 256 + (bytes[index + 1] ?? 0));
    }
    return value;
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return Buffer.from(bytes.slice(2)).toString("utf16le");
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodePdfUtf16IfPresent(value: string): string {
  if (value.length >= 2 && value.charCodeAt(0) === 0xfe && value.charCodeAt(1) === 0xff) {
    let decoded = "";
    for (let index = 2; index + 1 < value.length; index += 2) {
      decoded += String.fromCharCode(value.charCodeAt(index) * 256 + value.charCodeAt(index + 1));
    }
    return decoded;
  }
  return value;
}

function normalizePdfWhitespace(input: string): string {
  return replacePdfControlCharacters(input)
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function replacePdfControlCharacters(input: string): string {
  let output = "";
  for (const char of input) {
    const code = char.charCodeAt(0);
    output += (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127 ? " " : char;
  }
  return output;
}

function joinedLength(chunks: readonly string[]): number {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  return total;
}
