export {
  DEFAULT_FILE_SOURCE_NAME,
  DEFAULT_PASTE_SOURCE_NAME,
  MAX_SOURCE_MATERIAL_AGENT_PROMPT_CHARS,
  MAX_SOURCE_MATERIAL_BASE64_CHARS,
  MAX_SOURCE_MATERIAL_FILE_BYTES,
  MAX_SOURCE_MATERIAL_IMAGE_FILE_BYTES,
  MAX_SOURCE_MATERIAL_TEXT_CHARS,
  SUPPORTED_SOURCE_MATERIAL_EXTENSIONS,
  SUPPORTED_SOURCE_MATERIAL_MEDIA_TYPES,
} from "./limits.js";
export {
  extractSourceMaterialFromFile,
  extractSourceMaterialFromText,
  isSourceMaterialKind,
  sourceMaterialKindLabel,
} from "./extract.node.js";
export { extractFromImage } from "./vision.node.js";
export {
  applyProposalDraftCandidatePatch,
  createProposalDraftCandidate,
  extractSourceMaterialFacts,
  formatMissingInputs,
} from "./candidate.js";
export {
  SOURCE_MATERIAL_KINDS,
  type MissingInput,
  type MissingInputPriority,
  type ObservedPricing,
  type ObservedRoleSegment,
  type ObservedWorkflowValue,
  type ProposalDraftCandidate,
  type ProposalDraftCandidateDetailsPatch,
  type ProposalDraftCandidatePatch,
  type ProposalDraftCandidateProjectHints,
  type ProposalDraftCandidateValuePatch,
  type SourceMaterialConfidence,
  type SourceMaterialDocument,
  type SourceMaterialError,
  type SourceMaterialExtractionResult,
  type SourceMaterialFileInput,
  type SourceMaterialFacts,
  type SourceMaterialKind,
  type SourceMaterialMetadata,
  type SourceMaterialOrigin,
  type SourceMaterialTextInput,
} from "./types.js";
