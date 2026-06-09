import { z } from "zod";
import {
  BUILT_IN_STYLE_PRESET_IDS,
  resolveStylePreset,
} from "../../proposal/presets.js";
import { updateProposalDraft } from "../../proposal/draftStore.js";
import { defineTool, snapshotResult, TOOL_COMMIT, type ResolvedToolDeps } from "./shared.js";

const presetIdSchema = z.enum(BUILT_IN_STYLE_PRESET_IDS).describe(
  "Built-in style preset: 'triten' (5-page value-led, full-bleed cover, build diagram, " +
    "phase cards, payback banner) or 'generic' (clean professional, centered cover, bordered cards).",
);

/**
 * Apply a built-in style preset to the current draft. The preset controls the
 * visual layout, CSS, section ordering, and component patterns of the rendered
 * proposal — NOT the content or brand colors.
 */
export function applyStylePreset(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "apply_style_preset",
    description:
      "Apply a built-in visual style preset to the proposal. Controls layout, CSS, and section " +
      "structure of the rendered PDF/HTML. Options: 'triten' (5-page value-led, full-bleed cover, " +
      "build diagram, phase cards, payback banner — the default) or 'generic' (clean professional, " +
      "centered cover, bordered cards, simpler layout). Does NOT change content or brand colors.",
    executionMode: "sequential",
    parameters: z.object({
      presetId: presetIdSchema,
    }),
    execute: (args) => {
      const preset = resolveStylePreset(args.presetId);
      if (preset === null) {
        return snapshotResult(
          session,
          `Unknown style preset "${args.presetId}". Available: ${BUILT_IN_STYLE_PRESET_IDS.join(", ")}.`,
        );
      }

      const currentPresetId = session.store.current.stylePresetId;
      if (currentPresetId === args.presetId) {
        return snapshotResult(session, `Style preset is already "${args.presetId}"; no change.`);
      }

      session.store = updateProposalDraft(
        session.store,
        (draft) => ({ ...draft, stylePresetId: args.presetId }),
        { ...TOOL_COMMIT, label: `Apply style preset: ${args.presetId}` },
      );

      return snapshotResult(
        session,
        `Applied style preset "${args.presetId}" (${preset.name}). ` +
          `${preset.description}`,
      );
    },
  });
}
