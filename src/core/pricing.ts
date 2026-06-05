/**
 * Lens C — value-fraction price anchor + payback.
 *
 * Anchor: 10–20% of first-year value (methodology §4).
 * Payback uses the CONSERVATIVE (low) annual value so the claim is defensible:
 * "pays for itself in ~N months on time savings alone."
 */

import type { PricingModel, PricingResult, Tier, ValueResult } from "./types.js";

/** The price we lead with: first non-null tier, else null. */
export function leadPrice(tiers: readonly Tier[]): number | null {
  for (const t of tiers) if (t.price !== null) return t.price;
  return null;
}

export function runPricing(model: PricingModel, value: ValueResult): PricingResult {
  const targetBand = {
    low: value.yearOne.low * model.valueFraction.low,
    high: value.yearOne.high * model.valueFraction.high,
  };

  const price = leadPrice(model.tiers);
  const paybackMonths =
    price !== null && value.yearOne.low > 0 ? (price / value.yearOne.low) * 12 : null;

  return { targetBand, paybackMonths };
}
