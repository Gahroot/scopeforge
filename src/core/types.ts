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

/**
 * One year of the multi-year savings ramp (e.g. Year 1 $150–180K, Year 2 $200K+,
 * Year 3 $275–325K+). `low`/`high` express the recurring-savings band for that year;
 * an open-ended target ("$200K+") is modelled as `low === high`.
 */
export interface RampYear {
  readonly year: number;
  readonly low: number;
  readonly high: number;
  readonly label?: string;
}

/** Lens B inputs — what it's worth to them in year one. */
export interface ValueModel {
  /** Fraction of theoretical saved time actually captured in year 1, as [low, high]. */
  readonly realizationFactor: Range;
  readonly segments: readonly RoleSegment[];
  readonly workflows: readonly NamedRange[];
  /** Avoided hires, replaced spend, throughput — shown but NEVER in payback. */
  readonly futureUpside: readonly NamedRange[];
  /** Multi-year recurring-savings ramp. Year 1 is the grounded base; later years compound. */
  readonly ramp?: readonly RampYear[];
}

/**
 * A pricing tier. `price === null` means intentionally unpriced ("scoped later").
 * `price` is always the NET amount the client pays. When a discount applies, the
 * gross→discount→net chain is captured by `standardPrice` and `discountPct`.
 */
export interface Tier {
  readonly name: string;
  /** Net price the client actually pays. `null` = intentionally unpriced. */
  readonly price: number | null;
  /** Gross / list price before any discount. */
  readonly standardPrice?: number;
  /** Discount applied to `standardPrice`, as a fraction in [0,1) (e.g. 0.33). */
  readonly discountPct?: number;
  /** Whether this tier is paid up front. */
  readonly paidUpFront?: boolean;
  readonly note?: string;
}

/**
 * A delivery phase as a first-class object. `status` reflects pricing certainty:
 * `fixed` = committed price, `estimated` = ballpark pending scope, `open` = deliberately
 * unpriced. `price === null` pairs with `status: "open"`.
 */
export interface Phase {
  readonly name: string;
  readonly status: "fixed" | "estimated" | "open";
  readonly price: number | null;
  readonly deliverables: readonly string[];
  readonly note?: string;
}

/** Recurring / ongoing engagement terms beyond the one-off build price. */
export interface Terms {
  /** Continuous support retainer, $/month. */
  readonly supportMonthly?: number;
  /** Post-launch support included at no extra cost, in days. */
  readonly supportIncludedDays?: number;
  /** Whether usage / licenses are billed separately from the build and support. */
  readonly usageBilledSeparately?: boolean;
  readonly note?: string;
}

/** Lens C inputs. */
export interface PricingModel {
  /** Anchor band as fraction of first-year value, e.g. [0.10, 0.20]. */
  readonly valueFraction: Range;
  readonly tiers: readonly Tier[];
  /** Delivery phases as first-class objects (fixed / estimated / open). */
  readonly phases?: readonly Phase[];
  /** Recurring engagement terms (support retainer, included support, usage billing). */
  readonly terms?: Terms;
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
