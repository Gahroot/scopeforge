import { z } from "zod";
import { updateProposalDraft as updateDraft } from "../../proposal/draftStore.js";
import type { ProposalBuildPlanStep } from "../../proposal/types.js";
import { defineTool, snapshotResult, TOOL_COMMIT, type ResolvedToolDeps } from "./shared.js";

function phaseTiming(index: number, weeksPerPhase: number): string {
  const start = index * weeksPerPhase + 1;
  const end = start + weeksPerPhase - 1;
  return start === end ? `Week ${start}` : `Weeks ${start}-${end}`;
}

/**
 * Deterministically turn the concrete deliverables (scope) into a sequenced
 * build/phase plan: one step per deliverable, with timing laid out back-to-back.
 * Activities come from each deliverable's `included` list; outcomes come from its
 * acceptance criteria, falling back to an acceptance statement.
 */
export function generatePhasePlanFromScope(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "generate_phase_plan_from_scope",
    description:
      "Generate a sequenced build/phase plan from the current deliverables (scope). One phase per " +
      "deliverable with back-to-back timing. Run after deliverables are set.",
    executionMode: "sequential",
    parameters: z.object({
      weeksPerPhase: z
        .number()
        .int()
        .positive()
        .max(12)
        .optional()
        .describe("Duration to allot each phase, in weeks. Default 2."),
    }),
    execute: (args) => {
      const draft = session.store.current;
      const deliverables = draft.actualDeliverables;
      if (deliverables.length === 0) {
        return snapshotResult(
          session,
          "Cannot generate a phase plan yet: no deliverables are set. Add deliverables first.",
        );
      }

      const weeksPerPhase = args.weeksPerPhase ?? 2;
      const buildPlan: ProposalBuildPlanStep[] = deliverables.map((deliverable, index) => ({
        name: deliverable.title,
        timing: phaseTiming(index, weeksPerPhase),
        description: deliverable.description,
        activities: deliverable.included,
        outcomes:
          deliverable.acceptanceCriteria !== undefined && deliverable.acceptanceCriteria.length > 0
            ? deliverable.acceptanceCriteria
            : [`${deliverable.title} delivered and accepted by the client`],
      }));

      session.store = updateDraft(session.store, (current) => ({ ...current, buildPlan }), {
        ...TOOL_COMMIT,
        label: "Generate phase plan",
      });

      return snapshotResult(
        session,
        `Generated a ${buildPlan.length}-phase plan spanning ${
          buildPlan.length * weeksPerPhase
        } week(s).`,
      );
    },
  });
}
