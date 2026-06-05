/**
 * ScopeForge engine — public surface.
 * `analyzeProject` runs all three lenses + guardrails deterministically.
 */

import type { Analysis, Project } from "./types.js";
import { makeRng } from "./random.js";
import { runCost, DEFAULT_ITERATIONS } from "./cost.js";
import { runValue } from "./value.js";
import { runPricing } from "./pricing.js";
import { checkGuardrails } from "./guardrails.js";

export interface AnalyzeOptions {
  /** Seed for the cost Monte Carlo. Fixed default → reproducible output. */
  readonly seed?: number;
  readonly iterations?: number;
}

export function analyzeProject(project: Project, opts: AnalyzeOptions = {}): Analysis {
  const rng = makeRng(opts.seed ?? 7);
  const cost = runCost(project.cost, rng, opts.iterations ?? DEFAULT_ITERATIONS);
  const value = runValue(project.value, project.client);
  const pricing = runPricing(project.pricing, value);
  const warnings = checkGuardrails(project, cost, value, pricing);
  return { cost, value, pricing, warnings };
}

export * from "./types.js";
export { makeRng, triangular } from "./random.js";
export { percentile, percentiles } from "./stats.js";
export { runCost, effectiveAiFactor, DEFAULT_ITERATIONS, CORRELATION_RISK_PAD } from "./cost.js";
export { runValue } from "./value.js";
export { runPricing, leadPrice } from "./pricing.js";
export { checkGuardrails } from "./guardrails.js";
