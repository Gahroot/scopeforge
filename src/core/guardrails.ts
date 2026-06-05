/**
 * The five rules from METHODOLOGY.md, encoded as machine-checkable warnings.
 * These live in the CORE so no UI screen can bypass them.
 */

import type { CostResult, Project, PricingResult, ValueResult, Warning } from "./types.js";
import { leadPrice } from "./pricing.js";

export function checkGuardrails(
  project: Project,
  cost: CostResult,
  value: ValueResult,
  pricing: PricingResult,
): Warning[] {
  const w: Warning[] = [];

  // Rule 5 — every table must foot. yearOne must equal realizedTime + workflows.
  const footLow = value.realizedTime.low + value.workflows.low;
  const footHigh = value.realizedTime.high + value.workflows.high;
  if (!approx(footLow, value.yearOne.low) || !approx(footHigh, value.yearOne.high)) {
    w.push({
      rule: "footing",
      severity: "error",
      message: "Year-1 value does not equal realized time + workflows. A haircut is hidden.",
    });
  }

  // Rule 2/3 — future upside must never be inside year-one value.
  if (value.yearOne.high >= value.theoreticalAnnual + value.futureUpside.high && value.futureUpside.high > 0) {
    w.push({
      rule: "future-leak",
      severity: "warning",
      message: "Year-1 value looks inflated by future upside. Keep avoided hires/replaced spend out of payback.",
    });
  }

  // Rule 1 — inputs should be real, not placeholders. Flag empty/degenerate models.
  if (project.value.segments.length === 0 && project.value.workflows.length === 0) {
    w.push({
      rule: "no-value-inputs",
      severity: "warning",
      message: "No value inputs yet. Gather real client numbers before trusting any price.",
    });
  }

  // Rule 4 / reconciliation — price must clear the cost floor.
  const price = leadPrice(project.pricing.tiers);
  if (price !== null && price < cost.priceFloor.p50) {
    w.push({
      rule: "below-floor",
      severity: "error",
      message: `Lead price ${money(price)} is below the P50 cost floor ${money(cost.priceFloor.p50)}. Restructure scope, don't discount.`,
    });
  }

  // Reconciliation — floor above the value band means wrong scope for this buyer.
  if (cost.priceFloor.p50 > value.yearOne.high && value.yearOne.high > 0) {
    w.push({
      rule: "floor-exceeds-value",
      severity: "warning",
      message: "Cost floor exceeds first-year value. Split into phases or trim scope.",
    });
  }

  // Rule 2 — AI factor wrongly applied to judgment work would be a silent over-discount.
  for (const ws of project.cost.workstreams) {
    if (ws.judgment && ws.aiFactor < 1) {
      w.push({
        rule: "ai-on-judgment",
        severity: "info",
        message: `"${ws.name}" is judgment work; its AI discount is ignored by the engine (correct), but clean up the input.`,
      });
    }
  }

  // Payback sanity — over a year on time-savings alone is a soft sell.
  if (pricing.paybackMonths !== null && pricing.paybackMonths > 12) {
    w.push({
      rule: "slow-payback",
      severity: "warning",
      message: `Payback is ${pricing.paybackMonths.toFixed(0)} months on conservative value. Tighten scope or revisit price.`,
    });
  }

  return w;
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
