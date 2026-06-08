import type { PreparedFor, ProposalActualDeliverable, ProposalTerms } from "../proposal/types.js";

export const SOURCE_MATERIAL_KINDS = [
  "meeting_notes",
  "transcript_summary",
  "text",
  "json",
  "pdf",
] as const;

export type SourceMaterialKind = (typeof SOURCE_MATERIAL_KINDS)[number];
export type SourceMaterialOrigin = "paste" | "upload" | "tool";
export type SourceMaterialConfidence = "low" | "medium" | "high";
export type MissingInputPriority = "required" | "recommended";

export interface SourceMaterialMetadata {
  readonly origin: SourceMaterialOrigin;
  readonly kind: SourceMaterialKind;
  readonly sourceName: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly characterLength: number;
  readonly truncated: boolean;
}

export interface SourceMaterialDocument {
  readonly metadata: SourceMaterialMetadata;
  readonly text: string;
  readonly warnings: readonly string[];
}

export interface SourceMaterialError {
  readonly code:
    | "source_material_empty"
    | "source_material_too_large"
    | "source_material_unsupported"
    | "source_material_invalid"
    | "source_material_pdf_unreadable";
  readonly message: string;
  readonly details?: readonly string[];
}

export type SourceMaterialExtractionResult =
  | { readonly ok: true; readonly document: SourceMaterialDocument }
  | { readonly ok: false; readonly error: SourceMaterialError };

export interface SourceMaterialTextInput {
  readonly text: string;
  readonly sourceKind?: SourceMaterialKind;
  readonly sourceName?: string;
  readonly mediaType?: string;
  readonly origin?: SourceMaterialOrigin;
  readonly maxTextCharacters?: number;
}

export interface SourceMaterialFileInput {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly mediaType?: string;
  readonly sourceKind?: SourceMaterialKind;
  readonly maxBytes?: number;
  readonly maxTextCharacters?: number;
}

export interface ObservedRoleSegment {
  readonly role: string;
  readonly headcount?: number;
  readonly hoursPerWeek?: number;
  readonly loadedRate?: number;
  readonly evidence: string;
}

export interface ObservedWorkflowValue {
  readonly name: string;
  readonly low?: number;
  readonly high?: number;
  readonly evidence: string;
}

export interface ObservedPricing {
  readonly label: string;
  readonly price?: number;
  readonly evidence: string;
}

export interface SourceMaterialFacts {
  readonly projectName?: string;
  readonly companyName?: string;
  readonly buyerName?: string;
  readonly buyerTitle?: string;
  readonly headcount?: number;
  readonly systems: readonly string[];
  readonly painPoints: readonly string[];
  readonly goals: readonly string[];
  readonly scopeItems: readonly string[];
  readonly deliverables: readonly string[];
  readonly roleSegments: readonly ObservedRoleSegment[];
  readonly workflowValues: readonly ObservedWorkflowValue[];
  readonly observedPricing: readonly ObservedPricing[];
  readonly assumptions: readonly string[];
  readonly constraints: readonly string[];
  readonly nextSteps: readonly string[];
}

export interface MissingInput {
  readonly key: string;
  readonly label: string;
  readonly reason: string;
  readonly priority: MissingInputPriority;
}

export interface ProposalDraftCandidateDetailsPatch {
  readonly title?: string;
  readonly recommendation?: string;
  readonly executiveSummary?: readonly string[];
  readonly whatWeHeard?: readonly string[];
}

export interface ProposalDraftCandidateValuePatch {
  readonly headline?: string;
  readonly narrative?: string;
  readonly unlocks?: readonly string[];
}

export interface ProposalDraftCandidateProjectHints {
  readonly projectName?: string;
  readonly client?: {
    readonly sizeHeadcount?: number;
    readonly buyerRole?: string;
  };
  readonly workstreams: readonly {
    readonly name: string;
    readonly evidence: string;
  }[];
  readonly valueSegments: readonly ObservedRoleSegment[];
  readonly workflowValues: readonly ObservedWorkflowValue[];
  readonly observedPricing: readonly ObservedPricing[];
}

export interface ProposalDraftCandidatePreparedForPatch {
  readonly companyName?: PreparedFor["companyName"];
  readonly buyerName?: Exclude<PreparedFor["buyerName"], undefined>;
  readonly buyerTitle?: Exclude<PreparedFor["buyerTitle"], undefined>;
}

export interface ProposalDraftCandidateTermsPatch {
  readonly assumptions?: ProposalTerms["assumptions"];
  readonly clientResponsibilities?: ProposalTerms["clientResponsibilities"];
}

export interface ProposalDraftCandidatePatch {
  readonly preparedFor?: ProposalDraftCandidatePreparedForPatch;
  readonly details?: ProposalDraftCandidateDetailsPatch;
  readonly valueProposal?: ProposalDraftCandidateValuePatch;
  readonly actualDeliverables?: readonly ProposalActualDeliverable[];
  readonly terms?: ProposalDraftCandidateTermsPatch;
  readonly nextSteps?: readonly string[];
  readonly projectHints: ProposalDraftCandidateProjectHints;
}

export interface ProposalDraftCandidate {
  readonly candidateId: string;
  readonly confidence: SourceMaterialConfidence;
  readonly source: SourceMaterialMetadata;
  readonly summary: string;
  readonly facts: SourceMaterialFacts;
  readonly draftPatch: ProposalDraftCandidatePatch;
  readonly missingInputs: readonly MissingInput[];
  readonly warnings: readonly string[];
}
