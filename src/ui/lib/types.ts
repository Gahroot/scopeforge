/**
 * Shared client/server contract for the conversational agent UI.
 * Type-only module: imported by both the React client and the Node SSE handler.
 */
import type { ProposalProjectConflictMetadata } from "../../project/store.node.js";
import type { ProposalAuthorMetadata } from "../../project/types.js";
import type { ProposalAudience, ProposalBrand, ProposalDraft } from "../../proposal/types.js";

export interface DraftPhaseView {
  readonly name: string;
  readonly price: number | null;
}

export interface DraftSnapshot {
  readonly draftId: string;
  readonly status: string;
  readonly templateId: string;
  readonly companyName: string;
  readonly buyerName?: string;
  readonly title: string;
  readonly recommendation: string;
  readonly executiveSummary: readonly string[];
  readonly valueHeadline: string;
  readonly annualValueTarget: number;
  readonly pricingSummary: string;
  readonly phases: readonly DraftPhaseView[];
  readonly nextSteps: readonly string[];
  readonly audience: ProposalAudience;
  readonly brandId: string;
  readonly stylePresetId?: string;
}

export interface EconomicsSnapshot {
  readonly leadPrice: number | null;
  readonly formattedLeadPrice: string;
  readonly yearOneValueRange: string;
  readonly targetPriceRange: string;
  readonly paybackMonths: string;
  readonly futureUpsideRange: string;
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface GuardrailIssue {
  readonly rule: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
}

export interface ValidationSnapshot {
  readonly ok: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly guardrails: readonly GuardrailIssue[];
  readonly blocking: readonly string[];
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly author: ProposalAuthorMetadata;
  readonly projectId?: string;
  readonly projectVersionId?: string;
  readonly draft: DraftSnapshot;
  readonly economics: EconomicsSnapshot | null;
  readonly validation: ValidationSnapshot;
  /** Full draft for deterministic preview/export round-trips. */
  readonly fullDraft: ProposalDraft;
  /** Active style preset ID. */
  readonly stylePresetId?: string;
}

/** Server-sent event frames over POST /api/agent/messages. */
export type AgentStreamFrame =
  | {
      readonly type: "session";
      readonly sessionId: string;
      readonly author?: ProposalAuthorMetadata;
    }
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "thinking_delta"; readonly text: string }
  | {
      readonly type: "thinking";
      readonly content: string;
      readonly thinkingLevel?: string;
    }
  | {
      readonly type: "tool_start";
      readonly toolCallId: string;
      readonly name: string;
      readonly label: string;
    }
  | {
      readonly type: "tool_end";
      readonly toolCallId: string;
      readonly name: string;
      readonly summary: string;
      readonly isError: boolean;
    }
  | { readonly type: "snapshot"; readonly snapshot: SessionSnapshot }
  | { readonly type: "done"; readonly totalTurns: number }
  | {
      readonly type: "error";
      readonly code: string;
      readonly message: string;
      readonly details?: readonly string[];
      readonly latestProject?: ProposalProjectConflictMetadata;
    };

export interface AgentMessageRequest {
  readonly sessionId?: string;
  readonly message: string;
  readonly projectId?: string;
  readonly baseVersion?: string;
  /** Start a disposable chat from the newest saved project state instead of replaying this session. */
  readonly newChatFromLatestProject?: boolean;
  readonly brandId?: string;
  readonly audience?: ProposalAudience;
  /** Optional collaborator identity; string author/displayName values are accepted by the local API. */
  readonly author?: ProposalAuthorMetadata | string;
  readonly displayName?: string;
  /** Imported vendor brand ("My brand") — drives proposal branding. */
  readonly vendorBrand?: ProposalBrand;
  /** Imported client brand ("Prepared for") — seeds the proposal's preparedFor. */
  readonly clientBrand?: ProposalBrand;
}
