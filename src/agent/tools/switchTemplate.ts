import { z } from "zod";
import { switchDraftTemplate } from "../../proposal/draftStore.js";
import { PROPOSAL_DRAFT_TEMPLATE_IDS } from "../../proposal/schema.js";
import { defineTool, snapshotResult, TOOL_COMMIT, type ResolvedToolDeps } from "./shared.js";

const templateIdSchema = z.enum(PROPOSAL_DRAFT_TEMPLATE_IDS);

/**
 * Switch the draft's render template. No-op (and reported as such) when the
 * requested template is already active. Content is preserved across templates.
 */
export function switchTemplate(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "switch_template",
    description:
      "Switch the proposal render template. Options: 'generic/value-proposal' (value-led) or " +
      "'generic/scope-review' (scope-led). Draft content is preserved.",
    executionMode: "sequential",
    parameters: z.object({ templateId: templateIdSchema }),
    execute: (args) => {
      const before = session.store.current.templateIds[0];
      if (before === args.templateId) {
        return snapshotResult(session, `Template is already "${args.templateId}"; no change.`);
      }
      session.store = switchDraftTemplate(session.store, args.templateId, {
        ...TOOL_COMMIT,
        label: "Switch template",
      });
      return snapshotResult(session, `Switched template to "${args.templateId}".`);
    },
  });
}
