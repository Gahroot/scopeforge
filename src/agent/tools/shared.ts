/**
 * Shared plumbing for the ScopeForge agent toolset.
 *
 * Every tool is a small factory bound to a {@link ToolContext} (a live session
 * plus injected, testable side-effect dependencies). Tools route all economics,
 * validation, and rendering through the existing deterministic modules so the
 * model can never invent numbers or bypass methodology guardrails.
 */

import { z } from "zod";
import type {
  AgentTool,
  StructuredToolResult,
  ToolContext as AgentToolContext,
  ToolExecuteResult,
  ToolExecutionMode,
} from "@kenkaiiii/gg-agent";
import type { NamedRange, Range, TriEstimate, Workstream } from "../../core/types.js";
import {
  renderProposalPdf as renderProposalPdfToFile,
  renderProposalPdfBytes,
  isMissingChromiumError,
} from "../../render/pdf.node.js";
import { buildSessionSnapshot, type AgentSession } from "../session.node.js";

/** Commit metadata stamped onto every draft mutation made by a tool. */
export const TOOL_COMMIT = { source: "agent" } as const;

/** A fixed fallback "generated at" date so previews/exports stay reproducible. */
export const DEFAULT_GENERATED_AT = new Date("2025-01-01T00:00:00.000Z");

export interface PdfRenderResult {
  readonly bytes: number;
  readonly outputPath: string | null;
  readonly format: string;
}

/**
 * Renders HTML to a PDF. Injected so tests use a fake and never need Chromium.
 * The default delegates to the real Playwright renderer.
 */
export type PdfRenderer = (options: {
  readonly html: string;
  readonly outputPath?: string;
  readonly signal?: AbortSignal;
}) => Promise<PdfRenderResult>;

export const defaultPdfRenderer: PdfRenderer = async (options) => {
  if (options.outputPath === undefined) {
    const result = await renderProposalPdfBytes({
      html: options.html,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return { bytes: result.bytes.byteLength, outputPath: null, format: result.format };
  }
  const result = await renderProposalPdfToFile({
    html: options.html,
    outputPath: options.outputPath,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return { bytes: result.bytes, outputPath: result.outputPath, format: result.format };
};

export { isMissingChromiumError };

/**
 * The live, mutable surface a tool operates on. `session.store` is replaced in
 * place by the draft-store updaters; `renderPdf` and `now` are injected for
 * determinism and test isolation.
 */
export interface ToolDeps {
  readonly session: AgentSession;
  readonly renderPdf?: PdfRenderer;
  readonly now?: () => Date;
}

export interface ResolvedToolDeps {
  readonly session: AgentSession;
  readonly renderPdf: PdfRenderer;
  readonly now: () => Date;
}

export function resolveToolDeps(deps: ToolDeps): ResolvedToolDeps {
  return {
    session: deps.session,
    renderPdf: deps.renderPdf ?? defaultPdfRenderer,
    now: deps.now ?? (() => DEFAULT_GENERATED_AT),
  };
}

interface ToolDefinition<T extends z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly executionMode?: ToolExecutionMode;
  readonly parameters: T;
  readonly execute: (
    args: z.infer<T>,
    context: AgentToolContext,
  ) => ToolExecuteResult | Promise<ToolExecuteResult>;
}

/** Infers zod-typed execute args while erasing to the library's AgentTool surface. */
export function defineTool<T extends z.ZodType>(definition: ToolDefinition<T>): AgentTool {
  return definition as unknown as AgentTool;
}

/** A tool factory bound to its dependencies. */
export type ToolFactory = (deps: ResolvedToolDeps) => AgentTool;

export function snapshotResult(session: AgentSession, message: string): StructuredToolResult {
  return { content: message, details: buildSessionSnapshot(session) };
}

// ---- Shared argument schemas -------------------------------------------------

export const triSchema = z.object({
  optimistic: z.number().positive(),
  likely: z.number().positive(),
  pessimistic: z.number().positive(),
});

export const rangeSchema = z.object({ low: z.number(), high: z.number() });

export const namedRangeSchema = z.object({
  name: z.string().min(1),
  low: z.number(),
  high: z.number(),
  note: z.string().min(1).optional(),
});

export const workstreamSchema = z.object({
  name: z.string().min(1),
  hours: triSchema,
  aiFactor: z.number().min(0).max(1),
  judgment: z.boolean(),
});

export function toTri(input: z.infer<typeof triSchema>): TriEstimate {
  return { optimistic: input.optimistic, likely: input.likely, pessimistic: input.pessimistic };
}

export function toRange(input: z.infer<typeof rangeSchema>): Range {
  return { low: input.low, high: input.high };
}

export function toNamedRange(input: z.infer<typeof namedRangeSchema>): NamedRange {
  return {
    name: input.name,
    low: input.low,
    high: input.high,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

export function toWorkstream(input: z.infer<typeof workstreamSchema>): Workstream {
  return {
    name: input.name,
    hours: toTri(input.hours),
    aiFactor: input.aiFactor,
    judgment: input.judgment,
  };
}

type DefinedPartial<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** Drops `undefined` keys so an optional patch never overwrites with `undefined`. */
export function cleanPatch<T extends Record<string, unknown>>(input: T): DefinedPartial<T> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (value !== undefined) output[key] = value;
  }
  return output as DefinedPartial<T>;
}
