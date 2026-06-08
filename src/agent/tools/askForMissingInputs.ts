import { z } from "zod";
import { validateProposalDraft as validateDraftSchema } from "../../proposal/schema.js";
import type { ProposalDraft } from "../../proposal/types.js";
import { defineTool, snapshotResult, type ResolvedToolDeps } from "./shared.js";

/** Maps a validation-error path prefix to a plain-language question for the buyer's consultant. */
const PATH_QUESTIONS: ReadonlyArray<readonly [prefix: string, question: string]> = [
  ["preparedFor.companyName", "Who is this proposal for — the client company name?"],
  ["project.cost.workstreams", "What needs to be built? List the workstreams with rough hour estimates."],
  [
    "project.value",
    "Where does the value come from? Share role time savings (role, headcount, hours/week, loaded rate) and/or workflow savings.",
  ],
  ["project.pricing", "What price are you anchoring to? Provide at least one priced tier or phase."],
  ["details.title", "What should the proposal be titled?"],
  ["details.recommendation", "In one sentence, what do you recommend the client do?"],
  ["details.executiveSummary", "What are the 2–3 key points for the executive summary?"],
  ["details", "What headline details (title, recommendation, summary) should the proposal carry?"],
  ["valueProposal", "What's the value headline and the unlocks the client cares about?"],
  ["buildPlan", "What are the build/delivery phases? (You can generate these from scope.)"],
  ["actualDeliverables", "What concrete deliverables will the client receive?"],
  ["pricing", "What's the pricing summary and the phase prices?"],
  ["terms", "What payment terms, assumptions, and exclusions apply?"],
  ["nextSteps", "What are the next steps for the client to move forward?"],
];

function questionForPath(path: string): string {
  for (const [prefix, question] of PATH_QUESTIONS) {
    if (path === prefix || path.startsWith(`${prefix}.`)) return question;
  }
  return `Provide a value for "${path}".`;
}

/** Soft readiness checks beyond schema validity, to coach toward a priced proposal. */
function economicGaps(draft: ProposalDraft): readonly string[] {
  const gaps: string[] = [];
  if (draft.project.cost.workstreams.length === 0) {
    gaps.push("What needs to be built? List the workstreams with rough hour estimates.");
  }
  if (draft.project.value.segments.length === 0 && draft.project.value.workflows.length === 0) {
    gaps.push("Where does the value come from? Share role time savings and/or workflow savings.");
  }
  if (!draft.pricing.phases.some((phase) => phase.price !== null)) {
    gaps.push("What price are you anchoring to? Provide at least one priced phase.");
  }
  return gaps;
}

/**
 * Inspect the draft deterministically (schema validation + economic readiness)
 * and return a deduplicated, prioritized list of the facts still needed before a
 * defensible, priced proposal can be produced.
 */
export function askForMissingInputs(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "ask_for_missing_inputs",
    description:
      "List the facts still missing before a priced proposal can be produced, as plain-language " +
      "questions to ask the consultant. Deterministic — derived from validation + economic readiness.",
    parameters: z.object({}),
    execute: () => {
      const draft = session.store.current;
      const questions = new Set<string>();

      const validation = validateDraftSchema(draft);
      if (!validation.ok) {
        for (const error of validation.errors) questions.add(questionForPath(error.path));
      }
      for (const gap of economicGaps(draft)) questions.add(gap);

      if (questions.size === 0) {
        return snapshotResult(
          session,
          "Nothing is missing — the draft has everything needed for a priced proposal.",
        );
      }

      const list = [...questions].map((q, index) => `${index + 1}. ${q}`).join("\n");
      return snapshotResult(session, `Still needed before this can be priced and sent:\n${list}`);
    },
  });
}
