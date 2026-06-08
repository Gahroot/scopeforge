import { z } from "zod";
import {
  MAX_SOURCE_MATERIAL_TEXT_CHARS,
  applyProposalDraftCandidatePatch,
  createProposalDraftCandidate,
  extractSourceMaterialFromText,
  formatMissingInputs,
} from "../../ingest/index.js";
import { updateProposalDraft } from "../../proposal/draftStore.js";
import { buildSessionSnapshot } from "../session.node.js";
import { defineTool, TOOL_COMMIT, type ResolvedToolDeps } from "./shared.js";

const sourceMaterialKindSchema = z.enum([
  "meeting_notes",
  "transcript_summary",
  "text",
  "json",
  "pdf",
]);

/**
 * Deterministically converts source notes/text into a proposal candidate, applying
 * only observed non-economic fields when asked. The economics remain missing until
 * the consultant supplies defensible cost, value, realization, and pricing inputs.
 */
export function ingestSourceMaterial(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "ingest_source_material",
    description:
      "Convert pasted meeting notes, transcript summaries, extracted text/JSON, or PDF text into a ProposalDraft candidate. " +
      "Lists missing inputs and never invents hours, value ranges, realization factors, or prices.",
    executionMode: "sequential",
    parameters: z.object({
      material: z.string().min(1).max(MAX_SOURCE_MATERIAL_TEXT_CHARS),
      sourceKind: sourceMaterialKindSchema.optional(),
      sourceName: z.string().min(1).optional(),
      applySafePatch: z
        .boolean()
        .optional()
        .describe(
          "When true, apply only observed narrative/client fields to the draft. Never applies economic estimates.",
        ),
    }),
    execute: (args) => {
      const extracted = extractSourceMaterialFromText({
        text: args.material,
        ...(args.sourceKind === undefined ? {} : { sourceKind: args.sourceKind }),
        ...(args.sourceName === undefined ? {} : { sourceName: args.sourceName }),
        origin: "tool",
      });
      if (!extracted.ok) {
        return {
          content: `Could not ingest source material: ${extracted.error.message}`,
          details: buildSessionSnapshot(session),
        };
      }

      const candidate = createProposalDraftCandidate(extracted.document);
      const applied = args.applySafePatch === true;
      if (applied) {
        session.store = updateProposalDraft(
          session.store,
          (draft) => applyProposalDraftCandidatePatch(draft, candidate),
          {
            ...TOOL_COMMIT,
            label: "Ingest source material",
            notes: [
              "Applied observed non-economic fields from source material. Cost, value, realization, and pricing numbers still require confirmation.",
            ],
          },
        );
      }

      return {
        content: [
          candidate.summary,
          applied
            ? "Applied safe observed fields to the draft; no economic estimates or prices were invented."
            : "Draft unchanged; review the candidate before applying any fields.",
          `Still needed:\n${formatMissingInputs(candidate.missingInputs)}`,
        ].join("\n\n"),
        details: {
          ...buildSessionSnapshot(session),
          sourceMaterial: { document: extracted.document, candidate, applied },
        },
      };
    },
  });
}
