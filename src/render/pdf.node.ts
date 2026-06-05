import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_PDF_FORMAT = "Letter";
const CHROMIUM_INSTALL_COMMAND = "npx playwright install chromium";

export class MissingChromiumError extends Error {
  readonly code = "chromium_missing";
  readonly installCommand = CHROMIUM_INSTALL_COMMAND;

  constructor(originalMessage: string) {
    super(
      `Playwright Chromium is not installed. Run this once from the project root: ${CHROMIUM_INSTALL_COMMAND}\n\nOriginal error:\n${originalMessage}`,
    );
    this.name = "MissingChromiumError";
  }
}

export interface RenderProposalPdfOptions {
  readonly html: string;
  readonly outputPath: string;
  readonly format?: string;
  readonly signal?: AbortSignal;
}

export interface RenderProposalPdfResult {
  readonly outputPath: string;
  readonly bytes: number;
  readonly format: string;
}

export interface RenderProposalPdfBytesOptions {
  readonly html: string;
  readonly format?: string;
  readonly signal?: AbortSignal;
}

export interface RenderProposalPdfBytesResult {
  readonly bytes: Uint8Array;
  readonly format: string;
}

interface RenderPdfBufferOptions {
  readonly html: string;
  readonly format: string;
  readonly outputPath?: string;
  readonly signal?: AbortSignal;
}

export async function renderProposalPdf(
  options: RenderProposalPdfOptions,
): Promise<RenderProposalPdfResult> {
  const outputPath = resolve(options.outputPath);
  const format = options.format ?? DEFAULT_PDF_FORMAT;
  await mkdir(dirname(outputPath), { recursive: true });

  const buffer = await renderPdfBuffer({
    html: options.html,
    format,
    outputPath,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  return {
    outputPath,
    bytes: buffer.byteLength,
    format,
  };
}

export async function renderProposalPdfBytes(
  options: RenderProposalPdfBytesOptions,
): Promise<RenderProposalPdfBytesResult> {
  const format = options.format ?? DEFAULT_PDF_FORMAT;
  const bytes = await renderPdfBuffer({
    html: options.html,
    format,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  return { bytes, format };
}

export function isMissingChromiumError(error: unknown): boolean {
  if (error instanceof MissingChromiumError) return true;

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("executable doesn't exist") ||
    normalized.includes("browser executable") ||
    (normalized.includes("playwright") && normalized.includes("install"))
  );
}

async function renderPdfBuffer(options: RenderPdfBufferOptions): Promise<Uint8Array> {
  throwIfAborted(options.signal);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true }).catch((error: unknown) => {
    throw withChromiumInstallHint(error);
  });

  try {
    throwIfAborted(options.signal);
    const page = await browser.newPage();
    await page.setContent(options.html, { waitUntil: "networkidle" });
    throwIfAborted(options.signal);
    return await page.pdf({
      ...(options.outputPath === undefined ? {} : { path: options.outputPath }),
      format: options.format,
      margin: {
        top: "0in",
        right: "0in",
        bottom: "0in",
        left: "0in",
      },
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
    });
  } finally {
    await browser.close();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new Error("Proposal PDF rendering was aborted.");
}

function withChromiumInstallHint(error: unknown): Error {
  if (!isMissingChromiumError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const originalMessage = error instanceof Error ? error.message : String(error);
  return new MissingChromiumError(originalMessage);
}
