import { z } from "zod";
import { formatMoney } from "../../proposal/format.js";
import { defineTool, snapshotResult, type ResolvedToolDeps } from "./shared.js";

/**
 * Read-only window onto the working draft. Returns a one-line summary in
 * `content` and the full {@link SessionSnapshot} (including `fullDraft`) in
 * `details` so the agent can inspect everything without mutating anything.
 */
export function readCurrentDraft(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "read_current_draft",
    description:
      "Read the current proposal draft and its derived economics/validation. " +
      "Call this first to see what is already known so you only ask for missing facts. Read-only.",
    parameters: z.object({}),
    execute: () => {
      const draft = session.store.current;
      const phases = draft.pricing.phases;
      const summary = [
        `Company: ${draft.preparedFor.companyName}.`,
        `Title: ${draft.details.title}.`,
        `Template: ${draft.templateIds[0] ?? "generic/value-proposal"}.`,
        `Workstreams: ${draft.project.cost.workstreams.length}.`,
        `Phases: ${
          phases.length === 0
            ? "none"
            : phases
                .map((p) => `${p.name}=${p.price === null ? "TBD" : formatMoney(p.price)}`)
                .join(", ")
        }.`,
      ].join(" ");
      return snapshotResult(session, summary);
    },
  });
}
