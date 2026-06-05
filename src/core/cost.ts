/**
 * Lens A — bottom-up cost floor via Monte Carlo.
 * Ported from the Triten prototype (triten_pricing/real.py), generalized and seeded.
 *
 * Per iteration:
 *   hours = Σ triangular(workstream) × effectiveAiFactor
 *   floor = hours × triangular(rate) / (1 − margin)
 *
 * Judgment work ignores aiFactor (AI doesn't accelerate modeling/QA — methodology §2).
 */

import type { CostModel, CostResult, Workstream } from "./types.js";
import { type Rng, triangular } from "./random.js";
import { percentile, percentiles } from "./stats.js";

export const DEFAULT_ITERATIONS = 50_000;
/** Tail padding for correlated integration risk (methodology §2). */
export const CORRELATION_RISK_PAD = 0.18;

/** Effective AI factor: judgment work is never discounted; others clamp to (0,1]. */
export function effectiveAiFactor(ws: Workstream): number {
  if (ws.judgment) return 1;
  if (!(ws.aiFactor > 0)) return 1;
  return Math.min(ws.aiFactor, 1);
}

export function runCost(model: CostModel, rng: Rng, iterations = DEFAULT_ITERATIONS): CostResult {
  const factors = model.workstreams.map(effectiveAiFactor);
  const hoursSamples = new Array<number>(iterations);
  const floorSamples = new Array<number>(iterations);
  const marginDivisor = 1 - model.margin;

  for (let i = 0; i < iterations; i++) {
    let hours = 0;
    for (let w = 0; w < model.workstreams.length; w++) {
      const workstream = model.workstreams[w];
      const factor = factors[w];
      if (workstream === undefined || factor === undefined) {
        throw new Error("Cost workstream and factor arrays are out of sync.");
      }
      const h = workstream.hours;
      hours += triangular(rng, h.optimistic, h.likely, h.pessimistic) * factor;
    }
    const r = model.blendedRate;
    const rate = triangular(rng, r.optimistic, r.likely, r.pessimistic);
    hoursSamples[i] = hours;
    floorSamples[i] = (hours * rate) / marginDivisor;
  }

  const priceFloor = percentiles(floorSamples);
  return {
    hours: percentiles(hoursSamples),
    priceFloor,
    riskAdjustedFloorP90: percentile(floorSamples, 0.9) * (1 + CORRELATION_RISK_PAD),
  };
}
