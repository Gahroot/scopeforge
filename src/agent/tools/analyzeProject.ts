import { z } from "zod";
import { analyzeProject as runAnalysis } from "../../core/index.js";
import { leadPrice } from "../../core/pricing.js";
import { formatMoney, formatMoneyRange, formatMonths } from "../../proposal/format.js";
import { proposalDraftToIntake } from "../../proposal/schema.js";
import { defineTool, snapshotResult, type ResolvedToolDeps } from "./shared.js";

/**
 * Run the deterministic three-lens analysis (cost floor → value ceiling →
 * pricing reconciliation) on the current draft. The model must never compute
 * these numbers itself; this is the only source of price/value/payback truth.
 */
export function analyzeProject(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "analyze_project",
    description:
      "Run the deterministic three-lens engine on the current draft and return the cost floor, " +
      "year-one value, target price band, lead price, and payback. Never compute these yourself.",
    parameters: z.object({
      seed: z.number().int().nonnegative().optional().describe("Monte Carlo seed (fixed default)."),
      iterations: z.number().int().positive().max(200_000).optional(),
    }),
    execute: (args) => {
      const draft = session.store.current;
      if (draft.project.cost.workstreams.length === 0) {
        return snapshotResult(
          session,
          "Cannot analyze yet: no cost workstreams are set. Add scoped workstreams first.",
        );
      }

      const intake = proposalDraftToIntake(draft);
      const analysis = runAnalysis(intake.project, {
        ...(args.seed === undefined ? {} : { seed: args.seed }),
        ...(args.iterations === undefined ? {} : { iterations: args.iterations }),
      });
      const price = leadPrice(intake.project.pricing.tiers);

      const summary = [
        `Lead price: ${price === null ? "scoped later" : formatMoney(price)}.`,
        `Year-one value: ${formatMoneyRange(analysis.value.yearOne)}.`,
        `Target price band: ${formatMoneyRange(analysis.pricing.targetBand)}.`,
        `Payback: ${formatMonths(analysis.pricing.paybackMonths)}.`,
        `Cost floor P50: ${formatMoney(analysis.cost.priceFloor.p50)}.`,
        analysis.warnings.length === 0
          ? "No guardrail warnings."
          : `Guardrails: ${analysis.warnings.map((w) => `${w.severity}:${w.rule}`).join(", ")}.`,
      ].join(" ");
      return snapshotResult(session, summary);
    },
  });
}
