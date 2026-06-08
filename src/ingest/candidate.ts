import type { Project } from "../core/types.js";
import type { ProposalActualDeliverable, ProposalDraft } from "../proposal/types.js";
import type {
  MissingInput,
  ObservedPricing,
  ObservedRoleSegment,
  ObservedWorkflowValue,
  ProposalDraftCandidate,
  ProposalDraftCandidateDetailsPatch,
  ProposalDraftCandidatePatch,
  ProposalDraftCandidatePreparedForPatch,
  ProposalDraftCandidateProjectHints,
  ProposalDraftCandidateTermsPatch,
  ProposalDraftCandidateValuePatch,
  SourceMaterialConfidence,
  SourceMaterialDocument,
  SourceMaterialFacts,
} from "./types.js";

interface LabelledLine {
  readonly label: string;
  readonly value: string;
}

interface MoneyRange {
  readonly low: number;
  readonly high: number;
}

const KNOWN_SYSTEMS: readonly string[] = [
  "Yardi",
  "Power BI",
  "Monday",
  "Salesforce",
  "HubSpot",
  "QuickBooks",
  "NetSuite",
  "Tableau",
  "Snowflake",
  "Notion",
  "Airtable",
  "SAP",
  "Jira",
  "Asana",
  "Slack",
  "Sage",
  "Excel",
  "SharePoint",
  "Procore",
  "Google Sheets",
  "Looker",
  "BigQuery",
  "Stripe",
  "Zapier",
  "Make",
];

const ROLE_PATTERNS: readonly RegExp[] = [
  /\bChief [A-Z][a-z]+ Officer\b/,
  /\bHead of [A-Z][\w]+(?: [A-Z]?[\w]+)?\b/,
  /\bVP(?: of)? [A-Z][\w]+(?: [A-Z]?[\w]+)?\b/,
  /\bVice President(?: of [A-Z][\w]+)?\b/,
  /\bDirector of [A-Z][\w]+\b/,
  /\b(?:COO|CFO|CEO|CTO|CIO|CMO|CRO)\b/,
  /\b(?:Founder|Owner|Principal|Partner|Controller|Director|Manager)\b/,
];

const PAIN_CUES: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /\bmanual(?:ly)?\b/i, label: "Manual work" },
  { pattern: /\breconcil/i, label: "Reconciliation" },
  { pattern: /\bcopy[- ]?paste|re-?key/i, label: "Copy-paste / rekeying" },
  { pattern: /\bspreadsheet|excel\b/i, label: "Spreadsheet sprawl" },
  { pattern: /\bbottleneck/i, label: "Process bottleneck" },
  { pattern: /\berror[- ]?prone|mistakes?\b/i, label: "Error-prone work" },
  { pattern: /\bslow|takes (?:hours|days)|hours? (?:each|every|per)/i, label: "Slow turnaround" },
  { pattern: /\bduplicat/i, label: "Duplicated effort" },
  { pattern: /\bvisibility|reporting\b/i, label: "Reporting visibility" },
  { pattern: /\binvestor reporting\b/i, label: "Investor reporting" },
  { pattern: /\bunderwriting\b/i, label: "Underwriting drag" },
];

const COMPANY_LABELS = new Set([
  "client",
  "client company",
  "client name",
  "company",
  "company name",
  "customer",
  "customer company",
  "account",
  "account company",
  "prepared for",
]);
const PROJECT_LABELS = new Set([
  "project",
  "project name",
  "engagement",
  "initiative",
  "proposal",
  "proposal title",
]);
const BUYER_LABELS = new Set([
  "buyer",
  "buyer role",
  "buyer title",
  "client buyer",
  "decision maker",
  "sponsor",
  "contact",
  "stakeholder",
]);
const HEADCOUNT_LABELS = new Set([
  "headcount",
  "client headcount",
  "company headcount",
  "company size",
  "company size headcount",
  "team size",
  "employees",
  "staff",
]);
const ASSUMPTION_LABELS = ["assumptions", "assumption"];
const CONSTRAINT_LABELS = ["constraints", "constraint", "risks", "risk", "timeline"];
const NEXT_STEP_LABELS = ["next steps", "next step", "follow up", "follow-up"];
const GOAL_LABELS = [
  "goal",
  "goals",
  "goal items",
  "objective",
  "objectives",
  "desired outcomes",
  "success",
];
const SCOPE_LABELS = [
  "scope",
  "scope item",
  "scope items",
  "requirements",
  "requirement",
  "needs",
  "build",
  "solution",
];
const DELIVERABLE_LABELS = [
  "deliverables",
  "deliverable",
  "deliverable items",
  "outputs",
  "output",
];
const PAIN_LABELS = [
  "pain",
  "pains",
  "pain points",
  "pain point items",
  "challenges",
  "problems",
  "current state",
];
const SYSTEM_LABELS = [
  "systems",
  "system",
  "system items",
  "tools",
  "tool",
  "tool items",
  "tech stack",
  "software",
];

const STOP_ROLE_WORDS = new Set([
  "people",
  "person",
  "employees",
  "staff",
  "members",
  "team members",
  "systems",
  "tools",
  "weeks",
  "months",
  "days",
  "hours",
  "years",
  "dollars",
  "usd",
  "pilot",
  "phase",
]);

export function createProposalDraftCandidate(
  document: SourceMaterialDocument,
): ProposalDraftCandidate {
  const facts = extractSourceMaterialFacts(document.text);
  const draftPatch = buildCandidatePatch(facts);
  const missingInputs = buildMissingInputs(facts);
  const confidence = candidateConfidence(facts);
  const summary = summarizeFacts(facts, missingInputs);

  return {
    candidateId: `source-${stableHash([document.metadata.sourceName, document.text].join("\n"))}`,
    confidence,
    source: document.metadata,
    summary,
    facts,
    draftPatch,
    missingInputs,
    warnings: document.warnings,
  };
}

export function extractSourceMaterialFacts(text: string): SourceMaterialFacts {
  const normalized = normalizeText(text);
  const lines = sourceLines(normalized);
  const labelled = labelledLines(lines);
  const companyName =
    firstLabelValue(labelled, COMPANY_LABELS) ?? extractMeetingWithCompany(normalized);
  const projectName = firstLabelValue(labelled, PROJECT_LABELS);
  const buyer = extractBuyer(labelled, normalized);
  const headcount = extractHeadcount(labelled, normalized);
  const systems = extractSystems(labelled, normalized);
  const painPoints = extractPainPoints(labelled, normalized);
  const goals = extractSectionItems(labelled, lines, GOAL_LABELS, 6);
  const scopeItems = extractSectionItems(labelled, lines, SCOPE_LABELS, 8);
  const deliverables = extractSectionItems(labelled, lines, DELIVERABLE_LABELS, 8);

  return {
    ...(projectName === undefined ? {} : { projectName: cleanFact(projectName) }),
    ...(companyName === undefined ? {} : { companyName: cleanFact(companyName) }),
    ...(buyer.name === undefined ? {} : { buyerName: buyer.name }),
    ...(buyer.title === undefined ? {} : { buyerTitle: buyer.title }),
    ...(headcount === undefined ? {} : { headcount }),
    systems,
    painPoints,
    goals,
    scopeItems,
    deliverables,
    roleSegments: extractRoleSegments(lines),
    workflowValues: extractWorkflowValues(lines),
    observedPricing: extractObservedPricing(lines),
    assumptions: extractSectionItems(labelled, lines, ASSUMPTION_LABELS, 8),
    constraints: extractSectionItems(labelled, lines, CONSTRAINT_LABELS, 8),
    nextSteps: extractSectionItems(labelled, lines, NEXT_STEP_LABELS, 6),
  };
}

export function applyProposalDraftCandidatePatch(
  draft: ProposalDraft,
  candidate: ProposalDraftCandidate,
): ProposalDraft {
  const patch = candidate.draftPatch;
  const project = applyProjectHints(draft.project, patch.projectHints);
  const preparedFor = patch.preparedFor ?? {};
  const details = patch.details ?? {};
  const valueProposal = patch.valueProposal ?? {};
  const terms = patch.terms ?? {};

  return {
    ...draft,
    project,
    preparedFor: { ...draft.preparedFor, ...preparedFor },
    details: { ...draft.details, ...details },
    valueProposal: { ...draft.valueProposal, ...valueProposal },
    actualDeliverables: mergeDeliverables(draft.actualDeliverables, patch.actualDeliverables ?? []),
    terms: {
      ...draft.terms,
      ...(terms.assumptions === undefined
        ? {}
        : { assumptions: mergeStrings(draft.terms.assumptions, terms.assumptions) }),
      ...(terms.clientResponsibilities === undefined
        ? {}
        : {
            clientResponsibilities: mergeStrings(
              draft.terms.clientResponsibilities,
              terms.clientResponsibilities,
            ),
          }),
    },
    ...(patch.nextSteps === undefined
      ? {}
      : { nextSteps: mergeStrings(draft.nextSteps, patch.nextSteps) }),
  } satisfies ProposalDraft;
}

export function formatMissingInputs(missingInputs: readonly MissingInput[]): string {
  if (missingInputs.length === 0) return "No missing inputs were identified.";
  return missingInputs.map((input, index) => `${index + 1}. ${input.label}`).join("\n");
}

function buildCandidatePatch(facts: SourceMaterialFacts): ProposalDraftCandidatePatch {
  const title = candidateTitle(facts);
  const recommendation = candidateRecommendation(facts);
  const summary = executiveSummary(facts);
  const heard = whatWeHeard(facts);
  const headline = valueHeadline(facts);
  const narrative = valueNarrative(facts);
  const unlocks = valueUnlocks(facts);
  const clientResponsibilities =
    facts.constraints.length === 0
      ? undefined
      : facts.constraints.map((item) => `Confirm: ${item}`);

  const preparedFor = {
    ...(facts.companyName === undefined ? {} : { companyName: facts.companyName }),
    ...(facts.buyerName === undefined ? {} : { buyerName: facts.buyerName }),
    ...(facts.buyerTitle === undefined ? {} : { buyerTitle: facts.buyerTitle }),
  } satisfies ProposalDraftCandidatePreparedForPatch;
  const details = {
    ...(title === undefined ? {} : { title }),
    ...(recommendation === undefined ? {} : { recommendation }),
    ...(summary === undefined ? {} : { executiveSummary: summary }),
    ...(heard === undefined ? {} : { whatWeHeard: heard }),
  } satisfies ProposalDraftCandidateDetailsPatch;
  const valueProposal = {
    ...(headline === undefined ? {} : { headline }),
    ...(narrative === undefined ? {} : { narrative }),
    ...(unlocks === undefined ? {} : { unlocks }),
  } satisfies ProposalDraftCandidateValuePatch;
  const terms = {
    ...(facts.assumptions.length === 0 ? {} : { assumptions: facts.assumptions }),
    ...(clientResponsibilities === undefined ? {} : { clientResponsibilities }),
  } satisfies ProposalDraftCandidateTermsPatch;
  const actualDeliverables = candidateDeliverables(facts);
  const projectHints = buildProjectHints(facts);

  return {
    ...(Object.keys(preparedFor).length === 0 ? {} : { preparedFor }),
    ...(Object.keys(details).length === 0 ? {} : { details }),
    ...(Object.keys(valueProposal).length === 0 ? {} : { valueProposal }),
    ...(actualDeliverables.length === 0 ? {} : { actualDeliverables }),
    ...(Object.keys(terms).length === 0 ? {} : { terms }),
    ...(facts.nextSteps.length === 0 ? {} : { nextSteps: facts.nextSteps }),
    projectHints,
  } satisfies ProposalDraftCandidatePatch;
}

function buildProjectHints(facts: SourceMaterialFacts): ProposalDraftCandidateProjectHints {
  const workstreams = candidateWorkstreamNames(facts).map((name) => ({
    name,
    evidence: workstreamEvidence(name, facts),
  }));
  const client = {
    ...(facts.headcount === undefined ? {} : { sizeHeadcount: facts.headcount }),
    ...(facts.buyerTitle === undefined ? {} : { buyerRole: facts.buyerTitle }),
  } satisfies NonNullable<ProposalDraftCandidateProjectHints["client"]>;

  return {
    ...(facts.projectName === undefined ? {} : { projectName: facts.projectName }),
    ...(Object.keys(client).length === 0 ? {} : { client }),
    workstreams,
    valueSegments: facts.roleSegments,
    workflowValues: facts.workflowValues,
    observedPricing: facts.observedPricing,
  } satisfies ProposalDraftCandidateProjectHints;
}

function buildMissingInputs(facts: SourceMaterialFacts): readonly MissingInput[] {
  const missing: MissingInput[] = [];
  if (facts.companyName === undefined) {
    missing.push(
      required("client.companyName", "Client company name", "No client/company label was found."),
    );
  }
  if (facts.buyerTitle === undefined) {
    missing.push(
      recommended(
        "client.buyerRole",
        "Buyer role/title",
        "The economic model needs the buyer context and authority level.",
      ),
    );
  }
  if (
    facts.goals.length === 0 &&
    facts.scopeItems.length === 0 &&
    facts.deliverables.length === 0
  ) {
    missing.push(
      required(
        "proposal.goal",
        "Project goal and success metric",
        "The source material did not clearly state what success looks like.",
      ),
    );
  }

  const workstreams = candidateWorkstreamNames(facts);
  if (workstreams.length === 0) {
    missing.push(
      required(
        "project.cost.workstreams",
        "Cost workstreams with hour estimates and AI factors",
        "No buildable workstreams were clear enough to price.",
      ),
    );
  } else {
    missing.push(
      required(
        "project.cost.workstreams.estimates",
        `Hour estimates and AI factors for: ${workstreams.join(", ")}`,
        "Source material can name scope, but it cannot supply a defensible cost floor by itself.",
      ),
    );
  }

  missing.push(
    required(
      "project.cost.blendedRateMargin",
      "Blended rate and target margin",
      "These are consultant economics and should be supplied deliberately.",
    ),
  );

  const incompleteSegments = facts.roleSegments.filter(
    (segment) =>
      segment.headcount === undefined ||
      segment.hoursPerWeek === undefined ||
      segment.loadedRate === undefined,
  );
  const hasCompleteRoleValue = facts.roleSegments.some(
    (segment) =>
      segment.headcount !== undefined &&
      segment.hoursPerWeek !== undefined &&
      segment.loadedRate !== undefined,
  );
  const hasWorkflowRange = facts.workflowValues.some(
    (workflow) => workflow.low !== undefined && workflow.high !== undefined,
  );

  if (!hasCompleteRoleValue && !hasWorkflowRange) {
    missing.push(
      required(
        "project.value.inputs",
        "Value inputs: role time savings and/or workflow dollar ranges",
        "The source did not include enough quantified value to compute year-one savings.",
      ),
    );
  }
  if (incompleteSegments.length > 0) {
    missing.push(
      required(
        "project.value.segments",
        `For observed roles, confirm headcount, hours/week saved, and loaded rates (${incompleteSegments
          .map((segment) => segment.role)
          .join(", ")})`,
        "Role names or headcounts were mentioned, but the value model needs the full time-savings inputs.",
      ),
    );
  }

  missing.push(
    required(
      "project.value.realizationFactor",
      "Year-one realization factor",
      "Do not assume how much theoretical savings the client will actually capture.",
    ),
  );

  if (facts.observedPricing.length === 0) {
    missing.push(
      required(
        "project.pricing.tiers",
        "At least one priced phase or tier",
        "No explicit price or budget was found in the source material.",
      ),
    );
  } else {
    missing.push(
      required(
        "project.pricing.confirmation",
        "Confirm whether the observed dollar amount is a budget, anchor, or committed price",
        "Numbers found in notes should not be promoted to proposal pricing without confirmation.",
      ),
    );
  }

  if (facts.assumptions.length === 0) {
    missing.push(
      recommended(
        "terms.assumptions",
        "Assumptions, exclusions, and client responsibilities",
        "The proposal needs the conditions that make the scope true.",
      ),
    );
  }
  if (facts.nextSteps.length === 0) {
    missing.push(
      recommended(
        "nextSteps",
        "Next steps for the client",
        "No explicit follow-up sequence was found.",
      ),
    );
  }

  return missing;
}

function applyProjectHints(project: Project, hints: ProposalDraftCandidateProjectHints): Project {
  return {
    ...project,
    ...(hints.projectName === undefined ? {} : { project: hints.projectName }),
    client: {
      ...project.client,
      ...(hints.client?.sizeHeadcount === undefined
        ? {}
        : { sizeHeadcount: hints.client.sizeHeadcount }),
      ...(hints.client?.buyerRole === undefined ? {} : { buyerRole: hints.client.buyerRole }),
    },
  } satisfies Project;
}

function extractBuyer(
  labelled: readonly LabelledLine[],
  text: string,
): { readonly name?: string; readonly title?: string } {
  const buyerLine = firstLabelValue(labelled, BUYER_LABELS);
  const title =
    buyerLine === undefined
      ? extractBuyerTitle(text)
      : (extractBuyerTitle(buyerLine) ?? extractBuyerTitle(text));
  const name = buyerLine === undefined ? undefined : extractBuyerName(buyerLine, title);
  return {
    ...(name === undefined ? {} : { name }),
    ...(title === undefined ? {} : { title }),
  };
}

function extractBuyerName(input: string, title: string | undefined): string | undefined {
  const candidate = input
    .split(/[,;|–—-]/)[0]
    ?.replace(title ?? "", "")
    .trim();
  if (candidate === undefined || candidate.length === 0) return undefined;
  if (!/[A-Z][a-z]+\s+[A-Z][a-z]+/.test(candidate)) return undefined;
  return candidate;
}

function extractBuyerTitle(input: string): string | undefined {
  for (const pattern of ROLE_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[0] !== undefined) return cleanFact(match[0]);
  }
  return undefined;
}

function extractHeadcount(labelled: readonly LabelledLine[], text: string): number | undefined {
  for (const line of labelled) {
    if (HEADCOUNT_LABELS.has(line.label)) {
      const value = firstInteger(line.value);
      if (value !== undefined) return value;
    }
  }

  const patterns: readonly RegExp[] = [
    /\bteam of (\d{1,5})\b/i,
    /\b(\d{1,5})\s*(?:people|employees|staff|team members|headcount|FTEs?)\b/i,
    /\bheadcount(?:\s*of)?\s*(\d{1,5})\b/i,
    /\b(\d{1,5})[- ]person\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] !== undefined) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return undefined;
}

function extractSystems(labelled: readonly LabelledLine[], text: string): readonly string[] {
  const systems = new Set<string>();
  for (const system of KNOWN_SYSTEMS) {
    const pattern = new RegExp(`\\b${escapeRegExp(system)}\\b`, "i");
    if (pattern.test(text)) systems.add(system);
  }

  const systemLabels = new Set(SYSTEM_LABELS);
  const labelledSystems = labelled
    .filter((line) => labelMatches(line.label, systemLabels))
    .flatMap((line) => splitList(line.value));
  for (const system of labelledSystems) {
    const cleaned = titleCaseAcronyms(cleanFact(system));
    if (cleaned.length > 1) systems.add(cleaned);
  }

  return [...systems].sort((left, right) => left.localeCompare(right));
}

function extractPainPoints(labelled: readonly LabelledLine[], text: string): readonly string[] {
  const points = new Set<string>();
  for (const cue of PAIN_CUES) {
    if (cue.pattern.test(text)) points.add(cue.label);
  }
  for (const item of extractSectionItems(labelled, sourceLines(text), PAIN_LABELS, 8)) {
    points.add(cleanFact(item));
  }
  return [...points].slice(0, 10);
}

function extractRoleSegments(lines: readonly string[]): readonly ObservedRoleSegment[] {
  const segments = new Map<string, ObservedRoleSegment>();
  const pattern =
    /\b(\d{1,4})\s+([a-z][a-z&/ -]{2,44}?)(?=\s+(?:spend|spends|save|saves|lose|loses|waste|wastes|work|currently|who|using|on|in|team|staff|employees|people)|[,.;]|$)/gi;

  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      const headcount = Number.parseInt(match[1] ?? "", 10);
      const role = normaliseRole(match[2] ?? "");
      if (!Number.isFinite(headcount) || headcount <= 0 || role.length === 0) continue;
      if (STOP_ROLE_WORDS.has(role.toLowerCase())) continue;

      const key = role.toLowerCase();
      if (segments.has(key)) continue;
      const hoursPerWeek = extractHoursPerWeek(line);
      const loadedRate = extractLoadedRate(line);
      segments.set(key, {
        role,
        headcount,
        ...(hoursPerWeek === undefined ? {} : { hoursPerWeek }),
        ...(loadedRate === undefined ? {} : { loadedRate }),
        evidence: line,
      });
    }
  }

  return [...segments.values()];
}

function extractWorkflowValues(lines: readonly string[]): readonly ObservedWorkflowValue[] {
  const workflows: ObservedWorkflowValue[] = [];
  for (const line of lines) {
    if (!/(value|saving|savings|workflow|manual|avoid|cost|revenue|throughput)/i.test(line)) {
      continue;
    }
    if (/(budget|price|investment|fee|proposal)/i.test(line)) continue;
    const range = extractMoneyRange(line);
    if (range === null) continue;
    workflows.push({
      name: sentenceLabel(line, "Workflow value"),
      low: range.low,
      high: range.high,
      evidence: line,
    });
  }
  return uniqueBy(workflows, (workflow) => workflow.name.toLowerCase()).slice(0, 8);
}

function extractObservedPricing(lines: readonly string[]): readonly ObservedPricing[] {
  const prices: ObservedPricing[] = [];
  for (const line of lines) {
    if (!/(budget|price|investment|fee|proposal|pilot|phase|tier)/i.test(line)) continue;
    const range = extractMoneyRange(line);
    if (range === null) continue;
    prices.push({
      label: sentenceLabel(line, "Observed pricing"),
      price: range.high,
      evidence: line,
    });
  }
  return uniqueBy(prices, (pricing) => pricing.label.toLowerCase()).slice(0, 6);
}

function extractMoneyRange(line: string): MoneyRange | null {
  const moneyPattern =
    /\$\s*([0-9][0-9,.]*\s*(?:k|m)?)(?:\s*(?:-|–|—|to)\s*\$?\s*([0-9][0-9,.]*\s*(?:k|m)?))?/i;
  const match = line.match(moneyPattern);
  if (match?.[1] === undefined) return null;
  const first = parseMoney(match[1]);
  const second = match[2] === undefined ? first : parseMoney(match[2]);
  if (first === null || second === null) return null;
  return { low: Math.min(first, second), high: Math.max(first, second) };
}

function parseMoney(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const multiplier = trimmed.endsWith("m") ? 1_000_000 : trimmed.endsWith("k") ? 1_000 : 1;
  const numeric = trimmed.replace(/[,$\s]/g, "").replace(/[km]$/, "");
  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * multiplier);
}

function extractHoursPerWeek(line: string): number | undefined {
  const match = line.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:\/|per)\s*week\b/i);
  if (match?.[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractLoadedRate(line: string): number | undefined {
  const match = line.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:\/|per)?\s*(?:hr|hour)\b/i);
  if (match?.[1] === undefined) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractSectionItems(
  labelled: readonly LabelledLine[],
  lines: readonly string[],
  labels: readonly string[],
  maxItems: number,
): readonly string[] {
  const items: string[] = [];
  const labelSet = new Set(labels);
  for (const line of labelled) {
    if (labelMatches(line.label, labelSet)) {
      items.push(...splitList(line.value).map(cleanFact));
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const normalized = normalizeLabel(line.replace(/:$/, ""));
    if (!labelMatches(normalized, labelSet)) continue;

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const next = lines[nextIndex] ?? "";
      if (next.trim().length === 0) break;
      if (parseLabelledLine(next) !== null && !/^[-*•]/.test(next.trim())) break;
      const cleaned = cleanFact(next.replace(/^[-*•]\s*/, ""));
      if (cleaned.length > 0) items.push(cleaned);
      if (items.length >= maxItems) break;
    }
  }

  return uniqueStrings(items).slice(0, maxItems);
}

function candidateTitle(facts: SourceMaterialFacts): string | undefined {
  if (facts.projectName !== undefined) return facts.projectName;
  if (facts.companyName !== undefined) return `${facts.companyName} proposal candidate`;
  return undefined;
}

function candidateRecommendation(facts: SourceMaterialFacts): string | undefined {
  const target = firstNonEmpty([...facts.goals, ...facts.scopeItems, ...facts.deliverables]);
  if (target === undefined) return undefined;
  return `Confirm the economics for ${target} before pricing or sending this proposal.`;
}

function executiveSummary(facts: SourceMaterialFacts): readonly string[] | undefined {
  const summary: string[] = [];
  if (facts.companyName !== undefined) {
    summary.push(
      `Source material identifies ${facts.companyName}${facts.buyerTitle === undefined ? "" : ` with a ${facts.buyerTitle} buyer`} as the proposal context.`,
    );
  }
  if (facts.painPoints.length > 0) {
    summary.push(`Pain points mentioned: ${facts.painPoints.slice(0, 4).join(", ")}.`);
  }
  const scope = firstNonEmpty([...facts.scopeItems, ...facts.deliverables, ...facts.systems]);
  if (scope !== undefined) summary.push(`Candidate scope mentioned: ${scope}.`);
  if (summary.length === 0) return undefined;
  return summary;
}

function whatWeHeard(facts: SourceMaterialFacts): readonly string[] | undefined {
  const heard = uniqueStrings([
    ...facts.goals.map((goal) => `Goal: ${goal}`),
    ...facts.painPoints.map((pain) => `Pain: ${pain}`),
    ...(facts.systems.length === 0 ? [] : [`Systems in play: ${facts.systems.join(", ")}`]),
    ...facts.roleSegments.map((segment) =>
      segment.headcount === undefined
        ? `Role mentioned: ${segment.role}`
        : `Role mentioned: ${segment.headcount} ${segment.role}`,
    ),
  ]);
  return heard.length === 0 ? undefined : heard.slice(0, 8);
}

function valueHeadline(facts: SourceMaterialFacts): string | undefined {
  const goal = firstNonEmpty(facts.goals);
  if (goal !== undefined) return `Value hypothesis: ${goal}`;
  const pain = firstNonEmpty(facts.painPoints);
  if (pain !== undefined) return `Value hypothesis around ${pain}`;
  return undefined;
}

function valueNarrative(facts: SourceMaterialFacts): string | undefined {
  const anchors = uniqueStrings([...facts.painPoints, ...facts.systems, ...facts.scopeItems]).slice(
    0,
    5,
  );
  if (anchors.length === 0) return undefined;
  return `The source material points to ${anchors.join(", ")}. Treat this as a qualitative value hypothesis until role time savings, workflow ranges, and realization are confirmed.`;
}

function valueUnlocks(facts: SourceMaterialFacts): readonly string[] | undefined {
  const unlocks = uniqueStrings([...facts.goals, ...facts.painPoints, ...facts.deliverables]).slice(
    0,
    6,
  );
  return unlocks.length === 0 ? undefined : unlocks;
}

function candidateDeliverables(facts: SourceMaterialFacts): readonly ProposalActualDeliverable[] {
  const titles = uniqueStrings([
    ...facts.deliverables,
    ...facts.scopeItems,
    ...facts.systems.map((system) => `${system} integration`),
  ]).slice(0, 6);

  return titles.map((title) => ({
    title: titleFromText(title),
    description: `Candidate deliverable mentioned or implied by the source material: ${title}.`,
    included: ["Scope details and acceptance criteria to confirm before pricing."],
  }));
}

function candidateWorkstreamNames(facts: SourceMaterialFacts): readonly string[] {
  return uniqueStrings([
    ...facts.scopeItems.map(titleFromText),
    ...facts.deliverables.map(titleFromText),
    ...facts.systems.map((system) => `${system} integration`),
  ]).slice(0, 8);
}

function workstreamEvidence(name: string, facts: SourceMaterialFacts): string {
  const system = facts.systems.find((candidate) =>
    name.toLowerCase().includes(candidate.toLowerCase()),
  );
  if (system !== undefined) return `System mentioned: ${system}`;
  const source = [...facts.scopeItems, ...facts.deliverables].find((candidate) =>
    name.toLowerCase().includes(titleFromText(candidate).toLowerCase()),
  );
  return source ?? name;
}

function candidateConfidence(facts: SourceMaterialFacts): SourceMaterialConfidence {
  let score = 0;
  if (facts.companyName !== undefined) score += 1;
  if (facts.buyerTitle !== undefined) score += 1;
  if (facts.headcount !== undefined) score += 1;
  if (facts.systems.length > 0) score += 1;
  if (facts.painPoints.length > 0) score += 1;
  if (candidateWorkstreamNames(facts).length > 0) score += 1;
  if (facts.roleSegments.length > 0 || facts.workflowValues.length > 0) score += 1;
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function summarizeFacts(
  facts: SourceMaterialFacts,
  missingInputs: readonly MissingInput[],
): string {
  const pieces = [
    facts.companyName === undefined ? "client unknown" : `client ${facts.companyName}`,
    `${candidateWorkstreamNames(facts).length} candidate workstream(s)`,
    `${facts.painPoints.length} pain point(s)`,
    `${facts.roleSegments.length} role/value segment(s)`,
    `${missingInputs.length} missing input(s)`,
  ];
  return `Built a source-material proposal candidate: ${pieces.join(", ")}.`;
}

function required(key: string, label: string, reason: string): MissingInput {
  return { key, label, reason, priority: "required" };
}

function recommended(key: string, label: string, reason: string): MissingInput {
  return { key, label, reason, priority: "recommended" };
}

function sourceLines(text: string): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function labelledLines(lines: readonly string[]): readonly LabelledLine[] {
  return lines.map(parseLabelledLine).filter((line): line is LabelledLine => line !== null);
}

function parseLabelledLine(line: string): LabelledLine | null {
  const match = line.match(/^([A-Za-z][A-Za-z0-9 ._/\-[\]]{1,80})\s*:\s*(.+)$/);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return {
    label: normalizeLabel(match[1]),
    value: cleanFact(match[2]),
  };
}

function normalizeLabel(input: string): string {
  return input
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstLabelValue(
  lines: readonly LabelledLine[],
  labels: ReadonlySet<string>,
): string | undefined {
  for (const line of lines) {
    if (labelMatches(line.label, labels) && line.value.length > 0) return line.value;
  }
  return undefined;
}

function labelMatches(label: string, labels: ReadonlySet<string>): boolean {
  if (labels.has(label)) return true;
  for (const candidate of labels) {
    if (label.endsWith(` ${candidate}`)) return true;
  }
  return false;
}

function extractMeetingWithCompany(text: string): string | undefined {
  const match = text.match(/\bmeeting with (?:the )?([A-Z][\w&.-]+(?: [A-Z][\w&.-]+){0,3})/);
  if (match?.[1] === undefined) return undefined;
  return cleanFact(match[1]);
}

function firstInteger(input: string): number | undefined {
  const match = input.match(/\b(\d{1,5})\b/);
  if (match?.[1] === undefined) return undefined;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function splitList(input: string): readonly string[] {
  return input
    .split(/[,;]|\s+and\s+|\s+\+\s+/i)
    .map(cleanFact)
    .filter((item) => item.length > 0);
}

function cleanFact(input: string): string {
  return input
    .replace(/^[-*•]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[.;,]+$/g, "")
    .trim();
}

function titleFromText(input: string): string {
  const cleaned = cleanFact(input)
    .replace(/^build\s+/i, "")
    .replace(/^create\s+/i, "")
    .slice(0, 90);
  return cleaned.length === 0 ? "Candidate deliverable" : capitalizeFirst(cleaned);
}

function titleCaseAcronyms(input: string): string {
  if (/^[A-Z0-9 ]+$/.test(input)) return input;
  return input
    .split(" ")
    .map((word) => (word.length <= 3 ? word.toUpperCase() : capitalizeFirst(word.toLowerCase())))
    .join(" ");
}

function normaliseRole(input: string): string {
  return cleanFact(input)
    .replace(/\b(and|of|the)\b$/i, "")
    .trim();
}

function sentenceLabel(input: string, fallback: string): string {
  const cleaned = cleanFact(input)
    .replace(/\$\s*[0-9][0-9,.]*(?:\s*(?:k|m))?/gi, "")
    .trim();
  if (cleaned.length === 0) return fallback;
  return titleFromText(cleaned.slice(0, 90));
}

function mergeDeliverables(
  existing: readonly ProposalActualDeliverable[],
  incoming: readonly ProposalActualDeliverable[],
): readonly ProposalActualDeliverable[] {
  const byTitle = new Map<string, ProposalActualDeliverable>();
  for (const item of existing) byTitle.set(item.title.toLowerCase(), item);
  for (const item of incoming) {
    if (!byTitle.has(item.title.toLowerCase())) byTitle.set(item.title.toLowerCase(), item);
  }
  return [...byTitle.values()];
}

function mergeStrings(existing: readonly string[], incoming: readonly string[]): readonly string[] {
  return uniqueStrings([...existing, ...incoming]);
}

function uniqueStrings(input: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of input) {
    const cleaned = cleanFact(item);
    if (cleaned.length === 0) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function uniqueBy<T>(input: readonly T[], keyFor: (item: T) => string): readonly T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of input) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function firstNonEmpty(items: readonly string[]): string | undefined {
  for (const item of items) {
    const cleaned = cleanFact(item);
    if (cleaned.length > 0) return cleaned;
  }
  return undefined;
}

function normalizeText(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function capitalizeFirst(input: string): string {
  if (input.length === 0) return input;
  const first = input[0];
  if (first === undefined) return input;
  return `${first.toUpperCase()}${input.slice(1)}`;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
