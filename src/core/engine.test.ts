import { describe, it, expect } from "vitest";
import { makeRng, triangular } from "./random.js";
import { percentile } from "./stats.js";
import { runCost, effectiveAiFactor } from "./cost.js";
import { runValue } from "./value.js";
import { analyzeProject } from "./index.js";
import { tritenExample, createDefaultProject } from "../data/defaults.js";
import type { Workstream } from "./types.js";

describe("random", () => {
  it("is deterministic for a given seed", () => {
    const a = makeRng(7);
    const b = makeRng(7);
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
  });

  it("triangular stays within [min,max] and collapses degenerate spans", () => {
    const rng = makeRng(1);
    for (let i = 0; i < 1000; i++) {
      const x = triangular(rng, 10, 20, 40);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(40);
    }
    expect(triangular(rng, 5, 5, 5)).toBe(5);
  });

  it("triangular mean approximates (min+mode+max)/3", () => {
    const rng = makeRng(42);
    let s = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) s += triangular(rng, 10, 20, 60);
    expect(s / n).toBeCloseTo((10 + 20 + 60) / 3, 0);
  });
});

describe("stats.percentile", () => {
  it("interpolates", () => {
    const d = [1, 2, 3, 4, 5];
    expect(percentile(d, 0)).toBe(1);
    expect(percentile(d, 1)).toBe(5);
    expect(percentile(d, 0.5)).toBe(3);
  });
});

describe("cost — AI leverage rule", () => {
  it("ignores aiFactor on judgment work, applies it otherwise", () => {
    const judgment: Workstream = {
      name: "QA",
      hours: { optimistic: 1, likely: 1, pessimistic: 1 },
      aiFactor: 0.5,
      judgment: true,
    };
    const build: Workstream = {
      name: "Connector",
      hours: { optimistic: 1, likely: 1, pessimistic: 1 },
      aiFactor: 0.5,
      judgment: false,
    };
    expect(effectiveAiFactor(judgment)).toBe(1);
    expect(effectiveAiFactor(build)).toBe(0.5);
  });

  it("produces an ordered P10<P50<P90 floor with margin baked in", () => {
    const res = runCost(tritenExample().cost, makeRng(7), 20_000);
    expect(res.priceFloor.p10).toBeLessThan(res.priceFloor.p50);
    expect(res.priceFloor.p50).toBeLessThan(res.priceFloor.p90);
    expect(res.riskAdjustedFloorP90).toBeGreaterThan(res.priceFloor.p90);
  });

  it("reproduces the Triten cost floor in the expected range (~$25–45K)", () => {
    const res = runCost(tritenExample().cost, makeRng(7), 50_000);
    expect(res.priceFloor.p50).toBeGreaterThan(20_000);
    expect(res.priceFloor.p50).toBeLessThan(55_000);
  });

  it("is reproducible across runs with the same seed", () => {
    const a = runCost(tritenExample().cost, makeRng(7), 10_000);
    const b = runCost(tritenExample().cost, makeRng(7), 10_000);
    expect(a.priceFloor.p50).toBe(b.priceFloor.p50);
  });
});

describe("value — footing rule (the rule we learned the hard way)", () => {
  it("yearOne equals realizedTime + workflows EXACTLY", () => {
    const v = runValue(tritenExample().value, tritenExample().client);
    expect(v.yearOne.low).toBeCloseTo(v.realizedTime.low + v.workflows.low, 6);
    expect(v.yearOne.high).toBeCloseTo(v.realizedTime.high + v.workflows.high, 6);
  });

  it("reproduces the Triten year-one band (~$100–170K)", () => {
    const v = runValue(tritenExample().value, tritenExample().client);
    expect(Math.round(v.yearOne.low)).toBeGreaterThan(90_000);
    expect(Math.round(v.yearOne.low)).toBeLessThan(115_000);
    expect(Math.round(v.yearOne.high)).toBeGreaterThan(150_000);
    expect(Math.round(v.yearOne.high)).toBeLessThan(185_000);
  });

  it("keeps future upside OUT of year-one value", () => {
    const v = runValue(tritenExample().value, tritenExample().client);
    expect(v.futureUpside.low).toBeGreaterThan(0);
    expect(v.yearOne.high).toBeLessThan(v.futureUpside.low + v.theoreticalAnnual);
  });
});

describe("pricing — payback uses conservative value", () => {
  it("computes ~5 month payback for the $40K Triten pilot", () => {
    const p = analyzeProject(tritenExample());
    const paybackMonths = p.pricing.paybackMonths;
    if (paybackMonths === null) throw new Error("Expected Triten pilot to have a payback.");
    expect(paybackMonths).toBeGreaterThan(3);
    expect(paybackMonths).toBeLessThan(7);
  });

  it("targets 10–20% of first-year value", () => {
    const { pricing, value } = analyzeProject(tritenExample());
    expect(pricing.targetBand.low).toBeCloseTo(value.yearOne.low * 0.1, 6);
    expect(pricing.targetBand.high).toBeCloseTo(value.yearOne.high * 0.2, 6);
  });
});

describe("guardrails", () => {
  it("the Triten example trips no errors", () => {
    const { warnings } = analyzeProject(tritenExample());
    expect(warnings.filter((w) => w.severity === "error")).toHaveLength(0);
  });

  it("flags a price below the cost floor", () => {
    const proj = tritenExample();
    const broken = {
      ...proj,
      pricing: { ...proj.pricing, tiers: [{ name: "Lowball", price: 5000 }] },
    };
    const { warnings } = analyzeProject(broken);
    expect(warnings.some((w) => w.rule === "below-floor" && w.severity === "error")).toBe(true);
  });

  it("warns when there are no value inputs (empty default project)", () => {
    const { warnings } = analyzeProject(createDefaultProject());
    expect(warnings.some((w) => w.rule === "no-value-inputs")).toBe(true);
  });

  it("rejects paid discovery/scoping as the lead tier", () => {
    const proj = tritenExample();
    const broken = {
      ...proj,
      pricing: { ...proj.pricing, tiers: [{ name: "Discovery Sprint", price: 35_000 }] },
    };
    const { warnings } = analyzeProject(broken);
    expect(warnings.some((w) => w.rule === "paid-discovery-lead" && w.severity === "error")).toBe(
      true,
    );
  });

  it("checks the first priced tier for paid discovery/scoping", () => {
    const proj = tritenExample();
    const broken = {
      ...proj,
      pricing: {
        ...proj.pricing,
        tiers: [
          { name: "Future build", price: null },
          { name: "Scoping Sprint", price: 35_000 },
        ],
      },
    };
    const { warnings } = analyzeProject(broken);
    expect(warnings.some((w) => w.rule === "paid-discovery-lead" && w.severity === "error")).toBe(
      true,
    );
  });
});
