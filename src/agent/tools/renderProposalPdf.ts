import { z } from "zod";
import { BUILT_IN_BRANDS } from "../../proposal/brands.js";
import { validateProposalDraft as validateDraftSchema } from "../../proposal/schema.js";
import type { ProposalAudience } from "../../proposal/types.js";
import { renderValueProposalHtml } from "../../render/valueProposalHtml.js";
import { resolveSessionVendorBrand, type AgentSession } from "../session.node.js";
import {
  defineTool,
  isMissingChromiumError,
  snapshotResult,
  type ResolvedToolDeps,
} from "./shared.js";

function resolveBrand(session: AgentSession) {
  return resolveSessionVendorBrand(session) ?? BUILT_IN_BRANDS.nolan;
}

/**
 * Render the current draft to a PDF. The draft must validate first. Rendering is
 * delegated to an injected {@link PdfRenderer} (real Playwright by default) so a
 * missing Chromium binary is reported as actionable guidance, not a crash.
 */
export function renderProposalPdf(deps: ResolvedToolDeps) {
  const { session, now, renderPdf } = deps;
  return defineTool({
    name: "render_proposal_pdf",
    description:
      "Export the current draft to a PDF (writes to outputPath, or measures bytes when omitted). " +
      "The draft must be valid first; run validate_proposal_draft if unsure.",
    parameters: z.object({
      audience: z.enum(["client", "internal"]).optional(),
      outputPath: z.string().min(1).optional().describe("File path to write the PDF to."),
    }),
    execute: async (args, context) => {
      const validation = validateDraftSchema(session.store.current);
      if (!validation.ok) {
        const issues = validation.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
        return snapshotResult(
          session,
          `Cannot export PDF: the draft is not valid yet. Fix: ${issues}`,
        );
      }

      const audience: ProposalAudience = args.audience ?? "client";
      const html = renderValueProposalHtml(session.store.current, {
        brand: resolveBrand(session),
        audience,
        generatedAt: now(),
      });

      try {
        const result = await renderPdf({
          html,
          ...(args.outputPath === undefined ? {} : { outputPath: args.outputPath }),
          signal: context.signal,
        });
        const where = result.outputPath === null ? "in memory" : `to ${result.outputPath}`;
        return snapshotResult(
          session,
          `Exported ${result.format} PDF ${where} (${result.bytes} bytes).`,
        );
      } catch (error) {
        if (isMissingChromiumError(error)) {
          return snapshotResult(
            session,
            "Cannot export PDF: the PDF engine (Chromium) is not installed. " +
              "Run `npx playwright install chromium`, then retry.",
          );
        }
        throw error;
      }
    },
  });
}
