/**
 * Deterministic randomness. The core never touches Math.random() — every sampler
 * takes an injected RNG so results are exact and repeatable in tests and CI.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
}

/** mulberry32 — tiny, fast, well-distributed seeded PRNG. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * Triangular sample given (min, mode, max). Mirrors Python's random.triangular.
 * Guards degenerate spans where min === max.
 */
export function triangular(rng: Rng, min: number, mode: number, max: number): number {
  if (max <= min) return min;
  const u = rng.next();
  const c = (mode - min) / (max - min);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}
