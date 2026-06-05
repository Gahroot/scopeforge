import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { analyzeProject, type AnalyzeOptions } from "../core/index.js";
import { installGlobalDiagnostics, logError } from "../diagnostics/logger.node.js";
import { BUILT_IN_BRANDS, validateProposalBrand } from "../proposal/brands.js";
import { getClientBlockingWarnings, buildProposalViewModel } from "../proposal/model.js";
import { validateProposalIntake } from "../proposal/schema.js";
import type { ProposalAudience, ProposalBrand, ProposalRenderOptions } from "../proposal/types.js";
import { renderProposalHtml } from "../render/proposalHtml.js";
import { renderProposalPdf } from "../render/pdf.node.js";

interface ProposalCliArgs {
  readonly inputPath: string;
  readonly brandId: string | null;
  readonly brandFilePath: string | null;
  readonly audience: ProposalAudience;
  readonly outputPath: string;
  readonly htmlPath: string | null;
  readonly seed: number | undefined;
  readonly iterations: number | undefined;
  readonly allowErrors: boolean;
}

const BUILT_IN_BRAND_IDS = ["nolan", "partners"] as const;

type CliSuccess = { readonly ok: true };
type CliFailure = {
  readonly ok: false;
  readonly message: string;
  readonly details?: readonly string[];
};
type CliResult = CliSuccess | CliFailure;
type CliValueResult<T> = { readonly ok: true; readonly value: T } | CliFailure;

async function main(argv: readonly string[]): Promise<CliResult> {
  installGlobalDiagnostics();
  const argsResult = parseArgs(argv);
  if (!argsResult.ok) return argsResult;
  const args = argsResult.value;

  const intakeJson = await readJsonFile(args.inputPath, "proposal intake");
  const intakeResult = validateProposalIntake(intakeJson);
  if (!intakeResult.ok) {
    return {
      ok: false,
      message: "Proposal intake is not ready for generation.",
      details: intakeResult.errors.map((error) => `${error.path}: ${error.message}`),
    };
  }

  const brandResult = await loadBrand(args);
  if (!brandResult.ok) return brandResult;

  const analysis = analyzeProject(intakeResult.value.project, buildAnalyzeOptions(args));
  const blockingWarnings = getClientBlockingWarnings(analysis, { audience: args.audience });
  if (blockingWarnings.length > 0) {
    return {
      ok: false,
      message:
        "Guardrail errors block client proposal generation. Fix the economics or rerun with --audience internal for debugging.",
      details: blockingWarnings.map((warning) => `${warning.rule}: ${warning.message}`),
    };
  }

  const viewModel = buildProposalViewModel(
    intakeResult.value,
    brandResult.value,
    analysis,
    buildRenderOptions(args),
  );
  const html = renderProposalHtml(viewModel);

  if (args.htmlPath !== null) {
    await writeTextFile(args.htmlPath, html);
  }

  const pdfResult = await renderProposalPdf({ html, outputPath: args.outputPath });
  const htmlLine = args.htmlPath === null ? "" : `\nHTML: ${resolve(args.htmlPath)}`;
  console.log(
    `PDF: ${pdfResult.outputPath} (${pdfResult.bytes.toLocaleString("en-US")} bytes)${htmlLine}`,
  );
  return { ok: true };
}

function parseArgs(argv: readonly string[]): CliValueResult<ProposalCliArgs> {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueArgs = new Set([
    "--input",
    "--brand",
    "--brand-file",
    "--audience",
    "--out",
    "--html",
    "--seed",
    "--iterations",
  ]);
  const flagArgs = new Set(["--allow-errors", "--help"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (flagArgs.has(arg)) {
      flags.add(arg);
      continue;
    }
    if (!valueArgs.has(arg)) {
      return { ok: false, message: `Unknown argument: ${arg}`, details: [usage()] };
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      return { ok: false, message: `Missing value for ${arg}.`, details: [usage()] };
    }
    values.set(arg, value);
    index += 1;
  }

  if (flags.has("--help")) {
    return { ok: false, message: usage() };
  }

  const inputPath = values.get("--input");
  const outputPath = values.get("--out");
  if (inputPath === undefined || outputPath === undefined) {
    return { ok: false, message: "Both --input and --out are required.", details: [usage()] };
  }

  const audienceValue = values.get("--audience") ?? "client";
  if (!isProposalAudience(audienceValue)) {
    return {
      ok: false,
      message: "--audience must be either client or internal.",
      details: [usage()],
    };
  }
  if (flags.has("--allow-errors") && audienceValue !== "internal") {
    return {
      ok: false,
      message: "--allow-errors is only for internal/debug output. Use --audience internal.",
      details: [usage()],
    };
  }

  const brandId = values.get("--brand") ?? null;
  const brandFilePath = values.get("--brand-file") ?? null;
  if (brandId !== null && brandFilePath !== null) {
    return {
      ok: false,
      message: "Use either --brand or --brand-file, not both.",
      details: [usage()],
    };
  }
  if (brandId !== null && !BUILT_IN_BRAND_IDS.some((id) => id === brandId)) {
    return { ok: false, message: "--brand must be nolan or partners.", details: [usage()] };
  }

  const seed = parseOptionalInteger(values.get("--seed"), "--seed");
  if (!seed.ok) return seed;
  const iterations = parseOptionalInteger(values.get("--iterations"), "--iterations");
  if (!iterations.ok) return iterations;

  return {
    ok: true,
    value: {
      inputPath,
      brandId,
      brandFilePath,
      audience: audienceValue,
      outputPath,
      htmlPath: values.get("--html") ?? null,
      seed: seed.value,
      iterations: iterations.value,
      allowErrors: flags.has("--allow-errors"),
    },
  };
}

async function loadBrand(args: ProposalCliArgs): Promise<CliValueResult<ProposalBrand>> {
  if (args.brandFilePath !== null) {
    const brandJson = await readJsonFile(args.brandFilePath, "brand profile");
    const result = validateProposalBrand(brandJson);
    if (!result.ok) {
      return {
        ok: false,
        message: "Brand profile is invalid.",
        details: result.errors.map((error) => `${error.path}: ${error.message}`),
      };
    }
    return result;
  }

  const brandId = args.brandId ?? "nolan";
  const brand = brandId === "partners" ? BUILT_IN_BRANDS.partners : BUILT_IN_BRANDS.nolan;
  return { ok: true, value: brand };
}

function buildAnalyzeOptions(args: ProposalCliArgs): AnalyzeOptions {
  return {
    ...(args.seed === undefined ? {} : { seed: args.seed }),
    ...(args.iterations === undefined ? {} : { iterations: args.iterations }),
  };
}

function buildRenderOptions(args: ProposalCliArgs): ProposalRenderOptions {
  return {
    audience: args.audience,
    ...(args.seed === undefined ? {} : { seed: args.seed }),
    ...(args.iterations === undefined ? {} : { iterations: args.iterations }),
    allowGuardrailErrors: args.allowErrors,
  };
}

async function readJsonFile(path: string, label: string): Promise<unknown> {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    throw new Error(`Could not read ${label} file at ${path}: ${formatError(error)}`);
  });

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Could not parse ${label} JSON at ${path}: ${formatError(error)}`);
  }
}

async function writeTextFile(path: string, content: string): Promise<void> {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
}

function parseOptionalInteger(
  input: string | undefined,
  label: string,
): CliValueResult<number | undefined> {
  if (input === undefined) return { ok: true, value: undefined };
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, message: `${label} must be a positive integer.`, details: [usage()] };
  }
  return { ok: true, value };
}

function isProposalAudience(input: string): input is ProposalAudience {
  return input === "client" || input === "internal";
}

function usage(): string {
  return [
    "Usage: npm run proposal -- --input path/to/proposal-intake.json --brand nolan --out out/client-proposal.pdf [options]",
    "Options:",
    "  --brand nolan|partners",
    "  --brand-file path/to/brand.json",
    "  --audience client|internal (default: client)",
    "  --html out/client-proposal.html",
    "  --seed 7",
    "  --iterations 50000",
    "  --allow-errors (internal/debug output only)",
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
    logError("scopeforge.cli.proposal.unhandled", error);
    console.error(formatError(error));
    process.exitCode = 1;
  });
