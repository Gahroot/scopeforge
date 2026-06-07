import { randomUUID } from "node:crypto";
import type { Message } from "@kenkaiiii/gg-ai";
import { analyzeProject } from "../core/index.js";
import { createDefaultProject } from "../data/defaults.js";
import { resolveBrand } from "../proposal/brands.js";
import {
  createProposalDraftStore,
  proposalIntakeToDraft,
  updateDraftPreparedFor,
} from "../proposal/draftStore.js";
import { formatMoney, formatMoneyRange, formatMonths } from "../proposal/format.js";
import { leadPrice } from "../core/pricing.js";
import { getClientBlockingWarnings } from "../proposal/model.js";
import { proposalDraftToIntake, validateProposalDraft } from "../proposal/schema.js";
import { createProposalAuthorMetadata } from "../project/state.js";
import type {
  ProposalAuthorMetadata,
  ProposalProjectId,
  ProposalProjectSourceOfTruth,
  ProposalProjectVersionId,
} from "../project/types.js";
import type {
  ProposalAudience,
  ProposalBrand,
  ProposalDraft,
  ProposalIntake,
} from "../proposal/types.js";
import type { PreparedForPatch } from "../proposal/draftStore.js";
import type { ProposalDraftStoreState } from "../proposal/draftStore.js";
import type {
  DraftSnapshot,
  EconomicsSnapshot,
  SessionSnapshot,
  ValidationSnapshot,
} from "../ui/lib/types.js";

const DEFAULT_BRAND_ID = "nolan";

export const DEFAULT_SESSION_AUTHOR = createProposalAuthorMetadata({
  authorId: "local-collaborator",
  displayName: "Local collaborator",
  kind: "human",
});

export interface AgentSession {
  readonly id: string;
  store: ProposalDraftStoreState;
  messages: Message[];
  brandId: string;
  audience: ProposalAudience;
  createdBy: ProposalAuthorMetadata;
  projectId?: ProposalProjectId;
  projectVersionId?: ProposalProjectVersionId;
  /** Imported vendor brand ("My brand"); null until imported. */
  vendorBrand: ProposalBrand | null;
  /** Imported client brand ("Prepared for"); null until imported. */
  clientBrand: ProposalBrand | null;
  abort: AbortController | null;
}

export interface SessionProjectContext {
  readonly projectId: ProposalProjectId;
  readonly versionId: ProposalProjectVersionId;
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
}

export interface SessionCreateOptions {
  readonly brandId?: string;
  readonly audience?: ProposalAudience;
  readonly author?: ProposalAuthorMetadata;
  readonly projectContext?: SessionProjectContext;
}

export interface SessionStore {
  create(options?: SessionCreateOptions): AgentSession;
  get(id: string): AgentSession | null;
  getOrCreate(id: string | undefined, options?: SessionCreateOptions): AgentSession;
}

export interface SessionStoreDependencies {
  readonly idFactory?: () => string;
}

export function createSessionStore(dependencies: SessionStoreDependencies = {}): SessionStore {
  const sessions = new Map<string, AgentSession>();
  const idFactory = dependencies.idFactory ?? (() => randomUUID());

  function create(options: SessionCreateOptions = {}): AgentSession {
    const id = idFactory();
    const projectContext = options.projectContext;
    const session: AgentSession = {
      id,
      store: createInitialSessionDraftStore(projectContext),
      messages: [],
      brandId: options.brandId ?? projectContext?.sourceOfTruth.vendorBrand.id ?? DEFAULT_BRAND_ID,
      audience: options.audience ?? "client",
      createdBy: options.author ?? DEFAULT_SESSION_AUTHOR,
      ...(projectContext === undefined
        ? {}
        : { projectId: projectContext.projectId, projectVersionId: projectContext.versionId }),
      vendorBrand: projectContext?.sourceOfTruth.vendorBrand ?? null,
      clientBrand: projectContext?.sourceOfTruth.clientBrand ?? null,
      abort: null,
    };

    sessions.set(id, session);
    return session;
  }

  function get(id: string): AgentSession | null {
    return sessions.get(id) ?? null;
  }

  function getOrCreate(id: string | undefined, options: SessionCreateOptions = {}): AgentSession {
    if (id !== undefined) {
      const existing = sessions.get(id);
      if (existing !== undefined) return existing;
    }
    return create(options);
  }

  return { create, get, getOrCreate };
}

function createInitialSessionDraftStore(
  projectContext: SessionProjectContext | undefined,
): ProposalDraftStoreState {
  if (projectContext === undefined) {
    return createProposalDraftStore(createStarterDraft(), { label: "Agent session start" });
  }
  return createProposalDraftStore(projectContext.sourceOfTruth.draft, {
    label: "Loaded selected project version",
  });
}

export function applyProjectContextToSession(
  session: AgentSession,
  projectContext: SessionProjectContext,
): void {
  session.projectId = projectContext.projectId;
  session.projectVersionId = projectContext.versionId;
  session.store = createInitialSessionDraftStore(projectContext);
  session.brandId = projectContext.sourceOfTruth.vendorBrand.id;
  session.vendorBrand = projectContext.sourceOfTruth.vendorBrand;
  session.clientBrand = projectContext.sourceOfTruth.clientBrand;
}

export function createStarterDraft(): ProposalDraft {
  const intake: ProposalIntake = {
    project: createDefaultProject(),
    preparedFor: { companyName: "Prospective client" },
    details: {
      title: "Untitled proposal",
      recommendation: "Recommendation to be defined with the client.",
      executiveSummary: ["Discovery in progress — gathering goals, value, and scope."],
      whatWeHeard: ["Initial context is still being collected."],
    },
    scope: [],
    milestones: [],
    assumptions: [],
    exclusions: [],
    clientInputs: [],
    nextSteps: [],
  };
  return proposalIntakeToDraft(intake, {
    templateId: "generic/value-proposal",
    source: "agent-session",
    notes: ["Started from an empty agent session."],
  });
}

export function buildSessionSnapshot(session: AgentSession): SessionSnapshot {
  const draft = session.store.current;
  const validation = buildValidationSnapshot(draft, session.audience);
  const economics = buildEconomicsSnapshot(draft);
  return {
    sessionId: session.id,
    author: session.createdBy,
    ...(session.projectId === undefined ? {} : { projectId: session.projectId }),
    ...(session.projectVersionId === undefined
      ? {}
      : { projectVersionId: session.projectVersionId }),
    draft: buildDraftSnapshot(session, draft),
    economics,
    validation,
    fullDraft: draft,
  };
}

function buildDraftSnapshot(session: AgentSession, draft: ProposalDraft): DraftSnapshot {
  return {
    draftId: draft.metadata.draftId,
    status: draft.metadata.status ?? "draft",
    templateId: draft.templateIds[0] ?? "generic/value-proposal",
    companyName: draft.preparedFor.companyName,
    ...(draft.preparedFor.buyerName === undefined
      ? {}
      : { buyerName: draft.preparedFor.buyerName }),
    title: draft.details.title,
    recommendation: draft.details.recommendation,
    executiveSummary: draft.details.executiveSummary,
    valueHeadline: draft.valueProposal.headline,
    annualValueTarget: draft.valueProposal.annualValueTarget,
    pricingSummary: draft.pricing.summary,
    phases: draft.pricing.phases.map((phase) => ({ name: phase.name, price: phase.price })),
    nextSteps: draft.nextSteps,
    audience: session.audience,
    brandId: session.brandId,
  };
}

function buildEconomicsSnapshot(draft: ProposalDraft): EconomicsSnapshot | null {
  if (draft.project.cost.workstreams.length === 0) return null;
  const intake = proposalDraftToIntake(draft);
  const analysis = analyzeProject(intake.project);
  const price = leadPrice(intake.project.pricing.tiers);
  return {
    leadPrice: price,
    formattedLeadPrice: price === null ? "Scoped after pilot" : formatMoney(price),
    yearOneValueRange: formatMoneyRange(analysis.value.yearOne),
    targetPriceRange: formatMoneyRange(analysis.pricing.targetBand),
    paybackMonths: formatMonths(analysis.pricing.paybackMonths),
    futureUpsideRange: formatMoneyRange(analysis.value.futureUpside),
  };
}

function buildValidationSnapshot(
  draft: ProposalDraft,
  audience: ProposalAudience,
): ValidationSnapshot {
  const result = validateProposalDraft(draft);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map((error) => ({ path: error.path, message: error.message })),
      guardrails: [],
      blocking: [],
    };
  }

  const intake = proposalDraftToIntake(result.value);
  const analysis = analyzeProject(intake.project);
  const blocking = getClientBlockingWarnings(analysis, { audience });
  return {
    ok: true,
    errors: [],
    guardrails: analysis.warnings.map((warning) => ({
      rule: warning.rule,
      severity: warning.severity,
      message: warning.message,
    })),
    blocking: blocking.map((warning) => `${warning.rule}: ${warning.message}`),
  };
}

export function resolveSessionBrandId(brandId: string): string {
  return resolveBrand(brandId) === null ? DEFAULT_BRAND_ID : brandId;
}

/**
 * Resolve the brand the proposal should render with: the imported vendor brand
 * when present, otherwise the built-in resolved from `brandId`.
 */
export function resolveSessionVendorBrand(session: AgentSession): ProposalBrand | null {
  return session.vendorBrand ?? resolveBrand(session.brandId);
}

/**
 * Seed the draft's `preparedFor` from an imported client brand and remember it on
 * the session. Idempotent: re-applying the same brand reproduces the same patch.
 */
export function applyClientBrandToSession(session: AgentSession, brand: ProposalBrand): void {
  const patch: PreparedForPatch = {
    companyName: brand.name,
    ...(brand.website === undefined ? {} : { website: brand.website }),
    logoText: brand.logoText,
    accentColor: brand.colors.accent,
  };
  session.store = updateDraftPreparedFor(session.store, patch, { label: "Seed client brand" });
  session.clientBrand = brand;
}
