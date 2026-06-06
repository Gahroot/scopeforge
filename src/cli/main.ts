#!/usr/bin/env node
/**
 * ScopeForge CLI — ties the deterministic engine to the HTML renderer.
 *
 * Reads a `Project` (or a full `Proposal`) JSON document from a file, runs
 * `analyzeProject` so every rendered number is freshly computed, assembles and
 * validates the document through the `parseProposal` Zod boundary, renders a
 * self-contained HTML proposal, and writes it to disk.
 *
 * Every external input — argv and file contents — is validated with Zod at the
 * boundary. Failures fail fast with a clear message and a non-zero exit code;
 * the deterministic `src/core` engine is never bypassed.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

import { type AnalyzeOptions, analyzeProject, leadPrice } from "../core/index.js";
import type { Analysis, Project } from "../core/types.js";
import { validateProject } from "../data/schema.js";
import { tritenProposal } from "../data/tritenProposal.js";
import { installGlobalDiagnostics, logError } from "../diagnostics/logger.node.js";
import { formatMoney, formatMoneyRange, formatMonths } from "../proposal/format.js";
import { parseProposal } from "../proposal/schema.js";
import type { NarrativeSection, Proposal } from "../proposal/types.js";
import { renderProposalHtml } from "../render/html.js";

const DEFAULT_OUTPUT_PATH = "./proposal.html";

type CliFailure = {
  readonly ok: false;
  readonly message: string;
  readonly details?: readonly string[];
};
type CliResult = { readonly ok: true } | CliFailure;
type CliValueResult<T> = { readonly ok: true; readonly value: T } | CliFailure;

interface CliArgs {
  readonly inputPath: string | null;
  readonly outputPath: string;
  readonly example: boolean;
  readonly seed: number | undefined;
}

async function main(argv: readonly string[]): Promise<CliResult> {
  installGlobalDiagnostics();

  const argsResult = parseArgs(argv);
  if (!argsResult.ok) return argsResult;
  const args = argsResult.value;

  const proposalResult = await loadProposal(args);
  if (!proposalResult.ok) return proposalResult;
  const proposal = proposalResult.value;

  const html = renderProposalHtml(proposal);
  const outputPath = resolve(args.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");

  const bytes = (await stat(outputPath)).size;
  printSummary(proposal, outputPath, bytes);
  return { ok: true };
}

// ---- Input loading ----------------------------------------------------------

async function loadProposal(args: CliArgs): Promise<CliValueResult<Proposal>> {
  const opts = buildAnalyzeOptions(args);

  if (args.example) {
    // The fixture is already a render-ready Proposal; recompute its analysis so
    // the engine still runs and any seed override is honoured.
    return assembleProposal(tritenProposal(), opts);
  }

  if (args.inputPath === null) {
    return {
      ok: false,
      message: "An input file path or --example is required.",
      details: [usage()],
    };
  }

  const jsonResult = await readJsonFile(args.inputPath);
  if (!jsonResult.ok) return jsonResult;
  return buildFromInput(jsonResult.value, opts);
}

/**
 * Route raw JSON to the right builder. A full `Proposal` carries authored
 * narrative (`meta`/`headline`/`unlocks`); anything else is treated as a bare
 * `Project` and given narrative derived from its own data.
 */
function buildFromInput(raw: unknown, opts: AnalyzeOptions): CliValueResult<Proposal> {
  if (isProposalShaped(raw)) {
    return assembleProposal(raw as Partial<Proposal>, opts);
  }

  const projectResult = validateProject(raw);
  if (!projectResult.ok) {
    return {
      ok: false,
      message: "Input is neither a full proposal nor a valid project.",
      details: projectResult.errors.map((error) => `${error.path}: ${error.message}`),
    };
  }

  const analysis = analyzeProject(projectResult.value, opts);
  const proposal = deriveProposalFromProject(projectResult.value, analysis);
  return validateProposal(proposal);
}

/**
 * Recompute the analysis from the document's own project and validate the whole
 * document through the Zod proposal boundary.
 */
function assembleProposal(
  source: Partial<Proposal>,
  opts: AnalyzeOptions,
): CliValueResult<Proposal> {
  if (!isRecord(source.project)) {
    return {
      ok: false,
      message: "Proposal is missing a `project` block.",
      details: [usage()],
    };
  }

  const projectResult = validateProject(source.project);
  if (!projectResult.ok) {
    return {
      ok: false,
      message: "Proposal `project` block is invalid.",
      details: projectResult.errors.map((error) => `${error.path}: ${error.message}`),
    };
  }

  const analysis = analyzeProject(projectResult.value, opts);
  return validateProposal({ ...source, project: projectResult.value, analysis });
}

function validateProposal(candidate: unknown): CliValueResult<Proposal> {
  const parsed = parseProposal(candidate);
  return { ok: true, value: parsed };
}

// ---- Bare-project → proposal derivation -------------------------------------

/**
 * Build a render-ready `Proposal` from a bare `Project`. Headline figures come
 * straight from the computed `Analysis`; narrative sections echo the project's
 * own workstreams, workflows, and phase deliverables — no invented marketing.
 */
function deriveProposalFromProject(project: Project, analysis: Analysis): Proposal {
  const net = leadPrice(project.pricing.tiers);
  const yearOne = analysis.value.yearOne;
  const payback = formatMonths(analysis.pricing.paybackMonths);
  const netLabel = net === null ? "scoped later" : formatMoney(net);

  return {
    meta: {
      vendor: "ScopeForge",
      recipient: project.client.buyerRole,
      engagement: project.project,
      date: new Date().toISOString().slice(0, 10),
    },
    project,
    analysis,
    headline: {
      savingsTarget: formatMoneyRange(yearOne),
      payback,
      summary: `${project.project}: net investment ${netLabel} against conservative year-one savings of ${formatMoneyRange(
        yearOne,
      )}, paying back in ${payback}.`,
    },
    unlocks: [narrativeSection("Where Year-One Savings Come From", workflowBullets(project))],
    whatWeBuild: [narrativeSection("What We Build", workstreamBullets(project))],
    deliverables: [narrativeSection("What You'll Actually Have", deliverableBullets(project))],
  };
}

function narrativeSection(heading: string, bullets: readonly string[]): NarrativeSection {
  return bullets.length > 0 ? { heading, bullets } : { heading, body: "Detailed during kickoff." };
}

function workflowBullets(project: Project): readonly string[] {
  return project.value.workflows.map(
    (workflow) =>
      `${workflow.name}: ${formatMoneyRange({ low: workflow.low, high: workflow.high })}`,
  );
}

function workstreamBullets(project: Project): readonly string[] {
  return project.cost.workstreams.map((workstream) => workstream.name);
}

function deliverableBullets(project: Project): readonly string[] {
  const fromPhases = (project.pricing.phases ?? []).flatMap((phase) => phase.deliverables);
  if (fromPhases.length > 0) return fromPhases;
  return project.value.futureUpside.map((upside) => upside.name);
}

// ---- Summary ----------------------------------------------------------------

function printSummary(proposal: Proposal, outputPath: string, bytes: number): void {
  const net = leadPrice(proposal.project.pricing.tiers);
  const lines = [
    "ScopeForge proposal",
    `  Engagement:     ${proposal.meta.engagement}`,
    `  Net price:      ${net === null ? "Scoped later" : formatMoney(net)}`,
    `  Payback:        ${formatMonths(proposal.analysis.pricing.paybackMonths)}`,
    `  Year-one value: ${formatMoneyRange(proposal.analysis.value.yearOne)}`,
    `  Output:         ${outputPath} (${bytes.toLocaleString("en-US")} bytes)`,
  ];
  console.log(lines.join("\n"));
}

// ---- Boundary parsing -------------------------------------------------------

const cliArgsSchema = z.object({
  inputPath: z.string().min(1).nullable(),
  outputPath: z.string().min(1),
  example: z.boolean(),
  seed: z.number().int().positive().optional(),
});

function parseArgs(argv: readonly string[]): CliValueResult<CliArgs> {
  let inputPath: string | null = null;
  let outputPath = DEFAULT_OUTPUT_PATH;
  let example = false;
  let seedRaw: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === "--help" || arg === "-h") {
      return { ok: false, message: usage() };
    }
    if (arg === "--example") {
      example = true;
      continue;
    }
    if (arg === "--out" || arg === "--seed") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: `Missing value for ${arg}.`, details: [usage()] };
      }
      if (arg === "--out") outputPath = value;
      else seedRaw = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ok: false, message: `Unknown argument: ${arg}`, details: [usage()] };
    }
    if (inputPath !== null) {
      return { ok: false, message: `Unexpected extra argument: ${arg}`, details: [usage()] };
    }
    inputPath = arg;
  }

  const parsed = cliArgsSchema.safeParse({
    inputPath,
    outputPath,
    example,
    ...(seedRaw === undefined ? {} : { seed: Number(seedRaw) }),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Invalid arguments.",
      details: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "$"}: ${issue.message}`,
      ),
    };
  }

  const value = parsed.data;
  if (!value.example && value.inputPath === null) {
    return {
      ok: false,
      message: "Provide an input file path or pass --example.",
      details: [usage()],
    };
  }

  return {
    ok: true,
    value: {
      inputPath: value.inputPath,
      outputPath: value.outputPath,
      example: value.example,
      seed: value.seed,
    },
  };
}

function buildAnalyzeOptions(args: CliArgs): AnalyzeOptions {
  return args.seed === undefined ? {} : { seed: args.seed };
}

async function readJsonFile(path: string): Promise<CliValueResult<unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return { ok: false, message: `Could not read input file at ${path}: ${formatError(error)}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    return { ok: false, message: `Could not parse JSON at ${path}: ${formatError(error)}` };
  }
}

function isProposalShaped(value: unknown): boolean {
  return (
    isRecord(value) &&
    isRecord(value.meta) &&
    isRecord(value.headline) &&
    Array.isArray(value.unlocks)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usage(): string {
  return [
    "Usage: scopeforge <project-or-proposal.json> [--out path] [--seed n]",
    "       scopeforge --example [--out path]",
    "",
    "Reads a Project (or full Proposal) JSON, runs the ScopeForge engine, and",
    "writes a self-contained HTML proposal.",
    "",
    "Options:",
    `  --out <path>   Output HTML path (default: ${DEFAULT_OUTPUT_PATH})`,
    "  --seed <n>     Override the Monte-Carlo seed (positive integer)",
    "  --example      Use the built-in Triten proposal instead of a file",
    "  -h, --help     Show this help",
  ].join("\n");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main(process.argv.slice(2))
  .then((result) => {
    if (result.ok) return;
    console.error(result.message);
    if (result.details !== undefined) {
      for (const detail of result.details) console.error(detail);
    }
    process.exitCode = 1;
  })
  .catch((error: unknown) => {
    logError("scopeforge.cli.main.unhandled", error);
    console.error(formatError(error));
    process.exitCode = 1;
  });
