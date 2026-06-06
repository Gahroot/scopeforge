import { z } from "zod";
import { analyzeProject as runAnalysis } from "../../core/index.js";
import { updateDraftValueProposal } from "../../proposal/draftStore.js";
import { formatMoney, formatPercent } from "../../proposal/format.js";
import { proposalDraftToIntake } from "../../proposal/schema.js";
import type { ProposalValueSourceRow } from "../../proposal/types.js";
import { defineTool, snapshotResult, TOOL_COMMIT, type ResolvedToolDeps } from "./shared.js";

/**
 * Deterministically derive the client-facing value table from the structured
 * value inputs. Role segments are realized through the realization factor and
 * workflow savings are carried as-is, so the rows foot exactly to the engine's
 * year-one value. The table, value target, and six-month savings are persisted.
 */
export function generateValueTableFromInputs(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "generate_value_table_from_inputs",
    description:
      "Build the client-facing value table from the project's value segments and workflow savings. " +
      "Rows foot exactly to the engine's year-one value. Run after value inputs are set.",
    executionMode: "sequential",
    parameters: z.object({}),
    execute: () => {
      const draft = session.store.current;
      const value = draft.project.value;
      const client = draft.project.client;

      if (value.segments.length === 0 && value.workflows.length === 0) {
        return snapshotResult(
          session,
          "Cannot build a value table yet: no role segments or workflow savings are set.",
        );
      }

      const rf = value.realizationFactor;
      const segmentRows: ProposalValueSourceRow[] = value.segments.map((segment) => {
        const theoretical =
          segment.headcount * segment.hoursPerWeek * client.workingWeeks * segment.loadedRate;
        return {
          label: segment.role,
          source: "Role time savings",
          currentState: `${segment.headcount} people × ${segment.hoursPerWeek} hrs/wk at ${formatMoney(
            segment.loadedRate,
          )}/hr`,
          futureState: `${formatPercent(rf.low)}–${formatPercent(rf.high)} of that time given back`,
          annualValue: { low: theoretical * rf.low, high: theoretical * rf.high },
          confidence: "medium",
        };
      });

      const workflowRows: ProposalValueSourceRow[] = value.workflows.map((workflow) => ({
        label: workflow.name,
        source: "Workflow savings",
        currentState: "Manual or fragmented today",
        futureState: "Automated or accelerated by the build",
        annualValue: { low: workflow.low, high: workflow.high },
        confidence: "medium",
      }));

      const valueSources = [...segmentRows, ...workflowRows];

      // Foot the table to the engine's year-one value and derive the headline numbers.
      const analysis = runAnalysis(proposalDraftToIntake(draft).project);
      const yearOne = analysis.value.yearOne;
      const annualValueTarget = Math.max(1, Math.round(yearOne.high));
      const sixMonthSavings = { low: yearOne.low / 2, high: yearOne.high / 2 };

      session.store = updateDraftValueProposal(
        session.store,
        { valueSources, annualValueTarget, sixMonthSavings },
        { ...TOOL_COMMIT, label: "Generate value table" },
      );

      return snapshotResult(
        session,
        `Generated ${valueSources.length} value row(s) footing to year-one value of ` +
          `${formatMoney(yearOne.low)}–${formatMoney(yearOne.high)}.`,
      );
    },
  });
}
