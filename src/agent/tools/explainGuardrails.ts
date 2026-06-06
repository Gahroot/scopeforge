import { z } from "zod";
import { analyzeProject as runAnalysis } from "../../core/index.js";
import type { Severity } from "../../core/types.js";
import { proposalDraftToIntake } from "../../proposal/schema.js";
import { defineTool, snapshotResult, type ResolvedToolDeps } from "./shared.js";

/** Plain-language guidance for each methodology guardrail rule. */
const RULE_GUIDANCE: Readonly<Record<string, string>> = {
  footing:
    "Year-one value must equal realized time + workflow savings exactly. Regenerate the value table so it foots.",
  "future-leak":
    "Keep avoided hires and replaced spend in future upside only — never inside year-one value or payback.",
  "no-value-inputs":
    "Gather real role time savings and/or workflow savings before trusting any price.",
  "below-floor":
    "The lead price is under the P50 cost floor. Restructure scope to raise value — do not just discount.",
  "floor-exceeds-value":
    "The cost floor is above first-year value. Split into outcome-based phases or trim scope for this buyer.",
  "paid-discovery-lead":
    "Don't lead with paid discovery/scoping. Price an outcome-based pilot or build instead.",
  "ai-on-judgment":
    "A judgment workstream has an AI discount. The engine ignores it (correct), but clean up the input.",
  "slow-payback":
    "Payback exceeds 12 months on conservative value. Tighten scope or revisit the price.",
};

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

/**
 * Run the engine and translate every triggered methodology guardrail into a
 * prioritized, plain-language explanation the consultant can act on. Guardrails
 * live in core, so this never invents or suppresses a rule.
 */
export function explainGuardrails(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "explain_guardrails",
    description:
      "Run the engine and explain, in plain language, every methodology guardrail the current draft " +
      "triggers (errors first), with concrete fixes. Use this to coach the consultant.",
    parameters: z.object({}),
    execute: () => {
      const draft = session.store.current;
      if (draft.project.cost.workstreams.length === 0) {
        return snapshotResult(
          session,
          "Cannot check guardrails yet: no cost workstreams are set. Add scoped workstreams first.",
        );
      }

      const intake = proposalDraftToIntake(draft);
      const analysis = runAnalysis(intake.project);
      if (analysis.warnings.length === 0) {
        return snapshotResult(session, "No guardrails triggered. The economics look defensible.");
      }

      const ordered = [...analysis.warnings].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      );
      const lines = ordered.map((warning) => {
        const guidance = RULE_GUIDANCE[warning.rule] ?? warning.message;
        return `[${warning.severity}] ${warning.rule}: ${warning.message} Fix: ${guidance}`;
      });
      return snapshotResult(session, lines.join("\n"));
    },
  });
}
