/**
 * Meeting-summary ingestion adapter.
 *
 * Turns a Fathom AI meeting summary (plain text) into a PARTIAL {@link Project}
 * draft. The adapter is deliberately honest about its limits:
 *
 * **Only ~40% of a Project is auto-fillable from a meeting.** A call tells you
 * WHO the client is, HOW BIG they are, WHAT systems are in play, and WHICH pains
 * hurt. It does NOT tell you the build's cost floor, the AI acceleration of each
 * workstream, the realization factor, or the value fraction used to price.
 *
 * Those are the **cost lens**, and the cost lens is irreducibly human. This
 * adapter therefore fills only meeting-extractable fields and leaves every
 * judgment/cost knob absent so a person supplies it deliberately:
 *
 * - NEVER set: `cost.blendedRate`, `cost.margin`, per-workstream
 *   `hours`/`aiFactor`/`judgment`, `value.realizationFactor`,
 *   `pricing.valueFraction`.
 * - Role-segment `hoursPerWeek`/`loadedRate` and workflow dollar ranges are
 *   emitted as explicit `0` TODO placeholders (a clearly-not-real sentinel the
 *   human must replace), never as guessed numbers.
 *
 * Extraction is pluggable via an injected {@link MeetingExtractor}. The default,
 * {@link heuristicExtract}, is a dependency-free deterministic regex extractor
 * for offline use; a caller may inject an LLM-backed extractor that returns the
 * same {@link ExtractedFields} shape. The mapping from `ExtractedFields` to a
 * `Partial<Project>` is a pure, deterministic function — unit-testable without
 * any LLM call.
 */

import type {
  ClientContext,
  NamedRange,
  Phase,
  PricingModel,
  Project,
  RoleSegment,
  ValueModel,
  Workstream,
} from "../core/types.js";

// ---- Extraction contract ----------------------------------------------------

/** A role segment as a meeting reveals it: who, and how many. Time/rate are human judgment. */
export interface ExtractedSegment {
  readonly role: string;
  readonly headcount: number;
}

/**
 * The raw, meeting-extractable facts. This is the boundary between "reading the
 * transcript" (an LLM or a regex) and "drafting a Project" (pure mapping).
 * Everything here is something a person could point to in the summary; nothing
 * here is a costing/pricing judgment.
 */
export interface ExtractedFields {
  /** Project or client/company name. */
  readonly projectName?: string;
  /** The buyer's role/title (e.g. "COO"). */
  readonly buyerRole?: string;
  /** Total organisation headcount mentioned. */
  readonly headcount?: number;
  /** Role segments named on the call, with their headcount. */
  readonly segments: readonly ExtractedSegment[];
  /** Systems/tools mentioned (Yardi, Power BI, Monday, ...). */
  readonly systems: readonly string[];
  /** Pain-point themes mentioned, as short labels. */
  readonly painPoints: readonly string[];
}

/**
 * Pluggable extractor: summary text in, structured facts out. Inject an
 * LLM-backed implementation in production; default to {@link heuristicExtract}
 * offline. Kept as a plain function type (no class, no module-level state) so
 * the mapping stays deterministic and the seam is trivially mockable in tests.
 */
export type MeetingExtractor = (summary: string) => ExtractedFields;

export interface DraftProjectOptions {
  /** Extractor to use. Defaults to {@link heuristicExtract}. */
  readonly extract?: MeetingExtractor;
  /** Working weeks per year for the client context. Defaults to {@link DEFAULT_WORKING_WEEKS}. */
  readonly workingWeeks?: number;
}

// ---- Draft shape (deep-partial of Project) ----------------------------------

/**
 * A Project draft. Mirrors {@link Project} but every container omits the
 * judgment/cost scalars the meeting cannot supply, so they read as `undefined`.
 * `Project`'s full types are assignable to these looser draft types, which makes
 * the single boundary assertion in {@link draftProjectFromSummary} sound.
 */
interface WorkstreamDraft {
  readonly name: Workstream["name"];
}
interface CostDraft {
  readonly workstreams: readonly WorkstreamDraft[];
}
interface ValueDraft {
  readonly segments: ValueModel["segments"];
  readonly workflows: ValueModel["workflows"];
  readonly futureUpside: ValueModel["futureUpside"];
}
interface PricingDraft {
  readonly phases?: PricingModel["phases"];
}
interface ProjectDraft {
  readonly project?: Project["project"];
  readonly client?: ClientContext;
  readonly cost?: CostDraft;
  readonly value?: ValueDraft;
  readonly pricing?: PricingDraft;
}

// ---- Constants --------------------------------------------------------------

/** Default working weeks per year (matches `createDefaultProject`). */
export const DEFAULT_WORKING_WEEKS = 46;

/**
 * Sentinel for a number the meeting cannot supply but the schema requires
 * (role time-per-week, loaded rate, workflow dollar ranges). `0` is an obvious
 * "not real yet" placeholder a human is expected to replace.
 */
export const TODO_NUMBER = 0;

/** Known systems/tools, matched case-insensitively. Canonical display names. */
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
];

/** Buyer titles, longest-first so "Head of Ops" wins over "Manager". */
const ROLE_PATTERNS: readonly RegExp[] = [
  /\bChief [A-Z][a-z]+ Officer\b/,
  /\bHead of [A-Z][\w]+(?: [A-Z]?[\w]+)?\b/,
  /\bVP(?: of)? [A-Z][\w]+(?: [A-Z]?[\w]+)?\b/,
  /\bVice President(?: of [A-Z][\w]+)?\b/,
  /\bDirector of [A-Z][\w]+\b/,
  /\b(?:COO|CFO|CEO|CTO|CIO|CMO|CRO)\b/,
  /\b(?:Founder|Owner|Principal|Partner|Controller|Director)\b/,
];

/** Pain-point cue words → short theme label. Order is the emitted order. */
const PAIN_CUES: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /\bmanual(?:ly)?\b/i, label: "Manual data entry" },
  { pattern: /\breconcil/i, label: "Reconciliation" },
  { pattern: /\bcopy[- ]?paste|re-?key/i, label: "Copy-paste / rekeying" },
  { pattern: /\bspreadsheet|excel\b/i, label: "Spreadsheet sprawl" },
  { pattern: /\bbottleneck/i, label: "Process bottleneck" },
  { pattern: /\berror[- ]?prone|mistakes?\b/i, label: "Error-prone work" },
  { pattern: /\bslow|takes (?:hours|days)|hours? (?:each|every|per)/i, label: "Slow turnaround" },
  { pattern: /\bduplicat/i, label: "Duplicated effort" },
  { pattern: /\bvisibility|reporting\b/i, label: "Reporting visibility" },
];

// ---- Public API -------------------------------------------------------------

/**
 * Draft a `Partial<Project>` from a meeting summary.
 *
 * Pure given its `extract` dependency: the same summary + extractor always yield
 * the same draft. Fills only meeting-extractable fields; leaves all cost/value/
 * pricing judgment scalars absent (see module docs). Roughly 40% of a Project is
 * populated here — the cost lens stays human.
 *
 * @param summary Plain-text meeting summary (e.g. Fathom AI output).
 * @param opts Optional injected extractor and working-weeks override.
 */
export function draftProjectFromSummary(
  summary: string,
  opts: DraftProjectOptions = {},
): Partial<Project> {
  const extract = opts.extract ?? heuristicExtract;
  const workingWeeks = opts.workingWeeks ?? DEFAULT_WORKING_WEEKS;
  const fields = extract(summary);

  const draft: ProjectDraft = {
    ...(fields.projectName === undefined ? {} : { project: fields.projectName }),
    client: {
      sizeHeadcount: fields.headcount ?? 0,
      buyerRole: fields.buyerRole ?? "",
      workingWeeks,
    } satisfies ClientContext,
    cost: {
      // Workstream names only. hours/aiFactor/judgment are cost-lens judgment → absent.
      workstreams: fields.systems.map(
        (system): WorkstreamDraft => ({ name: `${system} integration` }),
      ),
    },
    value: {
      // Headcount per segment is observed; hoursPerWeek/loadedRate are placeholders.
      segments: fields.segments.map(
        (segment): RoleSegment => ({
          role: segment.role,
          headcount: segment.headcount,
          hoursPerWeek: TODO_NUMBER,
          loadedRate: TODO_NUMBER,
        }),
      ),
      // Pain themes become workflow labels; dollar bands are placeholders.
      workflows: fields.painPoints.map(
        (label): NamedRange => ({ name: label, low: TODO_NUMBER, high: TODO_NUMBER }),
      ),
      futureUpside: [] as readonly NamedRange[],
    },
    ...(fields.systems.length === 0
      ? {}
      : {
          pricing: {
            // Systems also surface as deliverables on an intentionally-unpriced phase.
            phases: [
              {
                name: "Systems integration",
                status: "open",
                price: null,
                deliverables: fields.systems.map((system) => `${system} integration`),
              } satisfies Phase,
            ],
          },
        }),
  };

  // Sound widening: every full `Project` container type is assignable to its
  // looser draft counterpart, so `Partial<Project>` is assignable to
  // `ProjectDraft` and the two are comparable. This is the single, deliberate
  // boundary cast that lets judgment scalars stay genuinely absent.
  return draft as Partial<Project>;
}

// ---- Default deterministic extractor ----------------------------------------

/**
 * Dependency-free, deterministic heuristic extractor. Pure regex/keyword passes
 * over the text — no network, no LLM, no randomness. Good enough for offline
 * drafting and as a stable default; swap in an LLM extractor for richer recall.
 */
export function heuristicExtract(summary: string): ExtractedFields {
  const projectName = extractProjectName(summary);
  const buyerRole = extractBuyerRole(summary);
  const headcount = extractHeadcount(summary);
  return {
    ...(projectName === undefined ? {} : { projectName }),
    ...(buyerRole === undefined ? {} : { buyerRole }),
    ...(headcount === undefined ? {} : { headcount }),
    segments: extractSegments(summary),
    systems: extractSystems(summary),
    painPoints: extractPainPoints(summary),
  };
}

function extractProjectName(summary: string): string | undefined {
  const labelled = summary.match(/^\s*(?:client|company|account|project|engagement)\s*:\s*(.+)$/im);
  if (labelled?.[1] !== undefined) return labelled[1].trim();
  const meetingWith = summary.match(/\bmeeting with (?:the )?([A-Z][\w&.-]+(?: [A-Z][\w&.-]+)?)/);
  if (meetingWith?.[1] !== undefined) return meetingWith[1].trim();
  return undefined;
}

function extractBuyerRole(summary: string): string | undefined {
  for (const pattern of ROLE_PATTERNS) {
    const match = summary.match(pattern);
    if (match?.[0] !== undefined) return match[0].trim();
  }
  return undefined;
}

function extractHeadcount(summary: string): number | undefined {
  const patterns: readonly RegExp[] = [
    /\bteam of (\d+)\b/i,
    /\b(\d+)\s*(?:people|employees|staff|team members|headcount|FTEs?)\b/i,
    /\bheadcount(?:\s*of)?\s*(\d+)\b/i,
  ];
  for (const pattern of patterns) {
    const match = summary.match(pattern);
    if (match?.[1] !== undefined) {
      const value = Number.parseInt(match[1], 10);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function extractSegments(summary: string): readonly ExtractedSegment[] {
  const seen = new Set<string>();
  const segments: ExtractedSegment[] = [];
  // "<n> <role words>" e.g. "7 analysts", "6 asset managers".
  const re = /\b(\d+)\s+([a-z][a-z]+(?:\s+(?:&|and|of)?\s*[a-z][a-z]+){0,2})/gi;
  for (const match of summary.matchAll(re)) {
    const count = Number.parseInt(match[1] ?? "", 10);
    const roleRaw = (match[2] ?? "").trim();
    if (!Number.isFinite(count) || roleRaw.length === 0) continue;
    if (isStopRole(roleRaw)) continue;
    const role = normaliseRole(roleRaw);
    const key = role.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    segments.push({ role, headcount: count });
  }
  return segments;
}

/** Filter "5 people"/"3 systems" style matches that are counts, not role segments. */
function isStopRole(role: string): boolean {
  const stop = new Set([
    "people",
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
  ]);
  return stop.has(role.toLowerCase());
}

function normaliseRole(role: string): string {
  return role.replace(/\s+/g, " ").trim();
}

function extractSystems(summary: string): readonly string[] {
  const found: string[] = [];
  for (const system of KNOWN_SYSTEMS) {
    const pattern = new RegExp(`\\b${escapeRegExp(system)}\\b`, "i");
    if (pattern.test(summary)) found.push(system);
  }
  // Deterministic, stable order = order in KNOWN_SYSTEMS (already canonical).
  return found;
}

function extractPainPoints(summary: string): readonly string[] {
  const labels: string[] = [];
  for (const cue of PAIN_CUES) {
    if (cue.pattern.test(summary) && !labels.includes(cue.label)) labels.push(cue.label);
  }
  return labels;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
