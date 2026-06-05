/**
 * Domain types — the single source of truth for every shape in ScopeForge.
 * Pure data. No behaviour, no imports.
 */

/** A three-point (PERT-style) estimate. */
export interface TriEstimate {
  readonly optimistic: number;
  readonly likely: number;
  readonly pessimistic: number;
}

/**
 * One unit of buildable work.
 * `aiFactor` is the fraction of hours remaining AFTER AI assistance (0–1].
 * `judgment` marks work AI does NOT meaningfully accelerate (data modeling,
 * reconciliation, QA). For judgment work the engine ignores aiFactor (treats it as 1).
 */
export interface Workstream {
  readonly name: string;
  readonly hours: TriEstimate;
  readonly aiFactor: number;
  readonly judgment: boolean;
}

/** Lens A inputs — what it costs us to build. */
export interface CostModel {
  /** Blended $/hr, three-point. */
  readonly blendedRate: TriEstimate;
  /** Target gross margin in [0,1). Profit lives inside the floor. */
  readonly margin: number;
  readonly workstreams: readonly Workstream[];
}

/** A role segment whose time the build gives back. */
export interface RoleSegment {
  readonly role: string;
  readonly headcount: number;
  readonly hoursPerWeek: number;
  readonly loadedRate: number;
}

/** A discrete workflow saving (faster cycles, not headcount removal). */
export interface NamedRange {
  readonly name: string;
  readonly low: number;
  readonly high: number;
  /** Optional label, e.g. "later phase". Marks future-only upside. */
  readonly note?: string;
}

/** Lens B inputs — what it's worth to them in year one. */
export interface ValueModel {
  /** Fraction of theoretical saved time actually captured in year 1, as [low, high]. */
  readonly realizationFactor: Range;
  readonly segments: readonly RoleSegment[];
  readonly workflows: readonly NamedRange[];
  /** Avoided hires, replaced spend, throughput — shown but NEVER in payback. */
  readonly futureUpside: readonly NamedRange[];
}

/** A pricing tier. `price === null` means intentionally unpriced ("scoped later"). */
export interface Tier {
  readonly name: string;
  readonly price: number | null;
  readonly note?: string;
}

/** Lens C inputs. */
export interface PricingModel {
  /** Anchor band as fraction of first-year value, e.g. [0.10, 0.20]. */
  readonly valueFraction: Range;
  readonly tiers: readonly Tier[];
}

export interface ClientContext {
  readonly sizeHeadcount: number;
  readonly buyerRole: string;
  readonly workingWeeks: number;
}

/** A full project = one JSON document. */
export interface Project {
  readonly project: string;
  readonly client: ClientContext;
  readonly cost: CostModel;
  readonly value: ValueModel;
  readonly pricing: PricingModel;
}

// ---- Result shapes ----------------------------------------------------------

export interface Range {
  readonly low: number;
  readonly high: number;
}

export interface CostResult {
  readonly hours: Percentiles;
  readonly priceFloor: Percentiles;
  /** P90 padded for correlated integration risk (see methodology §2). */
  readonly riskAdjustedFloorP90: number;
}

export interface Percentiles {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
}

export interface ValueResult {
  readonly theoreticalAnnual: number;
  readonly realizedTime: Range;
  readonly workflows: Range;
  /** Foundation-attributable year-one value = realizedTime + workflows. Foots exactly. */
  readonly yearOne: Range;
  readonly futureUpside: Range;
}

export interface PricingResult {
  readonly targetBand: Range;
  /** Months to recover, computed against the conservative (low) annual value. */
  readonly paybackMonths: number | null;
}

export type Severity = "error" | "warning" | "info";

export interface Warning {
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
}

export interface Analysis {
  readonly cost: CostResult;
  readonly value: ValueResult;
  readonly pricing: PricingResult;
  readonly warnings: readonly Warning[];
}
