import { z } from "zod";
import { BUILT_IN_BRANDS } from "../../proposal/brands.js";
import type { ProposalAudience } from "../../proposal/types.js";
import { renderValueProposalHtml } from "../../render/valueProposalHtml.js";
import { buildSessionSnapshot, resolveSessionVendorBrand, type AgentSession } from "../session.node.js";
import { defineTool, type ResolvedToolDeps } from "./shared.js";

function resolveBrand(session: AgentSession) {
  return resolveSessionVendorBrand(session) ?? BUILT_IN_BRANDS.nolan;
}

/**
 * Deterministically render the current draft to a full HTML document using the
 * session's resolved brand. The HTML is returned in `details.html`; `content`
 * is a short summary so the conversation stays readable.
 */
export function renderProposalPreview(deps: ResolvedToolDeps) {
  const { session, now } = deps;
  return defineTool({
    name: "render_proposal_preview",
    description:
      "Render the current draft to a self-contained HTML preview (brand-styled). Returns the HTML in " +
      "details.html. Deterministic — does not require Chromium.",
    parameters: z.object({
      audience: z.enum(["client", "internal"]).optional(),
    }),
    execute: (args) => {
      const audience: ProposalAudience = args.audience ?? "client";
      const html = renderValueProposalHtml(session.store.current, {
        brand: resolveBrand(session),
        audience,
        generatedAt: now(),
      });
      return {
        content: `Rendered HTML preview for ${session.store.current.preparedFor.companyName} (${html.length} chars).`,
        details: { snapshot: buildSessionSnapshot(session), html, audience },
      };
    },
  });
}
