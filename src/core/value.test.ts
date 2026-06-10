import { describe, it, expect } from "vitest";
import { runValue } from "./value.js";
import { tritenExample } from "../data/defaults.js";
import type { ValueModel, ClientContext, RampYear } from "./types.js";

const CLIENT: ClientContext = tritenExample().client;

/** Test helper: index into a possibly-undefined readonly array, failing loudly. */
function at<T>(arr: readonly T[] | undefined, index: number): T {
  const item = arr?.[index];
  if (item === undefined) throw new Error(`Expected element at index ${index}.`);
  return item;
}

/** Test helper: assert a value is defined, failing loudly. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to be defined.");
  return value;
}

describe("runValue — ramp processing", () => {
  it("returns undefined ramp and multiYearTotal when model has no ramp", () => {
    const model = tritenExample().value;
    const result = runValue(model, CLIENT);
    expect(result.ramp).toBeUndefined();
    expect(result.multiYearTotal).toBeUndefined();
  });

  it("does not change yearOne when ramp is absent", () => {
    const model = tritenExample().value;
    const result = runValue(model, CLIENT);
    expect(result.yearOne.low).toBeCloseTo(result.realizedTime.low + result.workflows.low, 6);
    expect(result.yearOne.high).toBeCloseTo(result.realizedTime.high + result.workflows.high, 6);
  });

  it("processes a single-year ramp using yearOne as base", () => {
    const model: ValueModel = {
      ...tritenExample().value,
      ramp: [{ year: 1, low: 100_000, high: 150_000 }],
    };
    const result = runValue(model, CLIENT);
    expect(result.ramp).toBeDefined();
    expect(result.ramp).toHaveLength(1);

    const year1 = at(result.ramp, 0);
    // Year 1 overrides with yearOne values, not the ramp input values
    expect(year1.low).toBe(result.yearOne.low);
    expect(year1.high).toBe(result.yearOne.high);
    expect(year1.cumulativeLow).toBe(result.yearOne.low);
    expect(year1.cumulativeHigh).toBe(result.yearOne.high);

    const total = defined(result.multiYearTotal);
    expect(total.low).toBe(result.yearOne.low);
    expect(total.high).toBe(result.yearOne.high);
  });

  it("computes cumulative totals across multiple years", () => {
    const model: ValueModel = {
      ...tritenExample().value,
      ramp: [
        { year: 1, low: 100_000, high: 150_000 },
        { year: 2, low: 200_000, high: 200_000 },
        { year: 3, low: 275_000, high: 325_000 },
      ],
    };
    const result = runValue(model, CLIENT);
    expect(result.ramp).toHaveLength(3);

    const y1 = at(result.ramp, 0);
    const y2 = at(result.ramp, 1);
    const y3 = at(result.ramp, 2);

    // Year 1 uses yearOne
    expect(y1.low).toBe(result.yearOne.low);
    expect(y1.high).toBe(result.yearOne.high);

    // Year 2 uses the ramp values directly
    expect(y2.low).toBe(200_000);
    expect(y2.high).toBe(200_000);

    // Year 3 uses the ramp values directly
    expect(y3.low).toBe(275_000);
    expect(y3.high).toBe(325_000);

    // Cumulative math
    expect(y2.cumulativeLow).toBeCloseTo(y1.low + y2.low, 6);
    expect(y2.cumulativeHigh).toBeCloseTo(y1.high + y2.high, 6);
    expect(y3.cumulativeLow).toBeCloseTo(y1.low + y2.low + y3.low, 6);
    expect(y3.cumulativeHigh).toBeCloseTo(y1.high + y2.high + y3.high, 6);

    // Multi-year total
    const total = defined(result.multiYearTotal);
    expect(total.low).toBeCloseTo(y3.cumulativeLow, 6);
    expect(total.high).toBeCloseTo(y3.cumulativeHigh, 6);
  });

  it("preserves ramp labels", () => {
    const ramp: readonly RampYear[] = [
      { year: 1, low: 100_000, high: 150_000, label: "Foundation" },
      { year: 2, low: 200_000, high: 200_000, label: "Expansion" },
    ];
    const model: ValueModel = { ...tritenExample().value, ramp };
    const result = runValue(model, CLIENT);
    expect(at(result.ramp, 0).label).toBe("Foundation");
    expect(at(result.ramp, 1).label).toBe("Expansion");
  });

  it("omits label field when ramp entry has no label (exactOptionalPropertyTypes)", () => {
    const ramp: readonly RampYear[] = [{ year: 1, low: 100_000, high: 150_000 }];
    const model: ValueModel = { ...tritenExample().value, ramp };
    const result = runValue(model, CLIENT);
    // The year1 result from ramp processing should not have a label key
    const year1 = at(result.ramp, 0);
    expect("label" in year1).toBe(false);
  });

  it("yearOne is unchanged regardless of ramp data", () => {
    const withoutRamp = runValue(tritenExample().value, CLIENT);
    const withRamp = runValue(
      {
        ...tritenExample().value,
        ramp: [
          { year: 1, low: 999, high: 999_999 },
          { year: 2, low: 500_000, high: 600_000 },
        ],
      },
      CLIENT,
    );
    expect(withoutRamp.yearOne.low).toBe(withRamp.yearOne.low);
    expect(withoutRamp.yearOne.high).toBe(withRamp.yearOne.high);
  });

  it("returns undefined ramp for an empty ramp array", () => {
    const model: ValueModel = { ...tritenExample().value, ramp: [] };
    const result = runValue(model, CLIENT);
    expect(result.ramp).toBeUndefined();
    expect(result.multiYearTotal).toBeUndefined();
  });
});
