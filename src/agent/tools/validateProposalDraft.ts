import { z } from "zod";
import { validateProposalDraft as validateDraftSchema } from "../../proposal/schema.js";
import { defineTool, snapshotResult, type ResolvedToolDeps } from "./shared.js";

/**
 * Deterministically validate the working draft against the proposal schema and
 * report what is still missing or invalid before it can be previewed/exported.
 */
export function validateProposalDraft(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "validate_proposal_draft",
    description:
      "Validate the current draft against the proposal schema and report any missing or invalid " +
      "fields. The draft must be valid before previewing or exporting a PDF.",
    parameters: z.object({}),
    execute: () => {
      const result = validateDraftSchema(session.store.current);
      if (result.ok) {
        return snapshotResult(session, "Draft is valid and ready for preview/export.");
      }
      const issues = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
      return snapshotResult(
        session,
        `Draft is not valid yet (${result.errors.length} issue(s)): ${issues}`,
      );
    },
  });
}
