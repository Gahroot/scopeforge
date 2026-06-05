/** Pure statistics helpers. No domain knowledge. */

import type { Percentiles } from "./types.js";

/** Linear-interpolated quantile, q in [0,1]. Sorts a copy. */
export function percentile(data: readonly number[], q: number): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const k = (sorted.length - 1) * q;
  const f = Math.floor(k);
  const c = Math.min(f + 1, sorted.length - 1);
  const lo = sorted[f] as number;
  const hi = sorted[c] as number;
  return lo + (hi - lo) * (k - f);
}

export function percentiles(data: readonly number[]): Percentiles {
  return { p10: percentile(data, 0.1), p50: percentile(data, 0.5), p90: percentile(data, 0.9) };
}

export function sum(data: readonly number[]): number {
  return data.reduce((acc, x) => acc + x, 0);
}
