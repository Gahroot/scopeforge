/**
 * Lens B — first-year value this build actually delivers.
 *
 * Footing rule (methodology §3): yearOne = realizedTime + workflows, EXACTLY.
 * Future upside (avoided hires, replaced spend) is computed separately and is never
 * folded into yearOne — so it can never leak into the payback calculation.
 */

import type { ClientContext, ValueModel, ValueResult } from "./types.js";
import { sum } from "./stats.js";

export function runValue(model: ValueModel, client: ClientContext): ValueResult {
  const theoreticalAnnual = sum(
    model.segments.map((s) => s.headcount * s.hoursPerWeek * client.workingWeeks * s.loadedRate),
  );

  const realizedTime = {
    low: theoreticalAnnual * model.realizationFactor.low,
    high: theoreticalAnnual * model.realizationFactor.high,
  };

  const workflows = {
    low: sum(model.workflows.map((w) => w.low)),
    high: sum(model.workflows.map((w) => w.high)),
  };

  const futureUpside = {
    low: sum(model.futureUpside.map((w) => w.low)),
    high: sum(model.futureUpside.map((w) => w.high)),
  };

  return {
    theoreticalAnnual,
    realizedTime,
    workflows,
    yearOne: {
      low: realizedTime.low + workflows.low,
      high: realizedTime.high + workflows.high,
    },
    futureUpside,
  };
}
