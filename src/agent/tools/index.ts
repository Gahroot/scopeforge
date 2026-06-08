/**
 * The ScopeForge agent toolset.
 *
 * `createScopeForgeTools` builds the full set of tools bound to one session and
 * its injected dependencies. Every tool routes economics, validation, and
 * rendering through the deterministic core/proposal/render modules so the model
 * can edit structured data and read numbers back — but never invent them.
 */

import type { AgentTool } from "@kenkaiiii/gg-agent";
import { resolveToolDeps, type ToolDeps } from "./shared.js";
import { readCurrentDraft } from "./readCurrentDraft.js";
import { updateProposalDraft } from "./updateProposalDraft.js";
import { validateProposalDraft } from "./validateProposalDraft.js";
import { analyzeProject } from "./analyzeProject.js";
import { explainGuardrails } from "./explainGuardrails.js";
import { renderProposalPreview } from "./renderProposalPreview.js";
import { renderProposalPdf } from "./renderProposalPdf.js";
import { askForMissingInputs } from "./askForMissingInputs.js";
import { ingestSourceMaterial } from "./ingestSourceMaterial.js";
import { switchTemplate } from "./switchTemplate.js";
import { applyBrand } from "./applyBrand.js";
import { reviseSectionCopy } from "./reviseSectionCopy.js";
import { generateValueTableFromInputs } from "./generateValueTableFromInputs.js";
import { generatePhasePlanFromScope } from "./generatePhasePlanFromScope.js";

export function createScopeForgeTools(deps: ToolDeps): AgentTool[] {
  const resolved = resolveToolDeps(deps);
  return [
    readCurrentDraft(resolved),
    updateProposalDraft(resolved),
    validateProposalDraft(resolved),
    analyzeProject(resolved),
    explainGuardrails(resolved),
    renderProposalPreview(resolved),
    renderProposalPdf(resolved),
    askForMissingInputs(resolved),
    ingestSourceMaterial(resolved),
    switchTemplate(resolved),
    applyBrand(resolved),
    reviseSectionCopy(resolved),
    generateValueTableFromInputs(resolved),
    generatePhasePlanFromScope(resolved),
  ];
}

export {
  readCurrentDraft,
  updateProposalDraft,
  validateProposalDraft,
  analyzeProject,
  explainGuardrails,
  renderProposalPreview,
  renderProposalPdf,
  askForMissingInputs,
  ingestSourceMaterial,
  switchTemplate,
  applyBrand,
  reviseSectionCopy,
  generateValueTableFromInputs,
  generatePhasePlanFromScope,
};
export {
  defaultPdfRenderer,
  resolveToolDeps,
  type PdfRenderer,
  type PdfRenderResult,
  type ResolvedToolDeps,
  type ToolDeps,
  type ToolFactory,
} from "./shared.js";
