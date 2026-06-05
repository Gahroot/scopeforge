import { describe, expect, it } from "vitest";
import { tritenExample } from "./defaults.js";
import { validateProject } from "./schema.js";

describe("validateProject", () => {
  it("accepts the Triten fixture", () => {
    const result = validateProject(tritenExample());

    expect(result.ok).toBe(true);
  });

  it("reports path-based errors for invalid margin and ranges", () => {
    const triten = tritenExample();
    const result = validateProject({
      ...triten,
      cost: {
        ...triten.cost,
        margin: 1,
      },
      value: {
        ...triten.value,
        realizationFactor: { low: 0.8, high: 0.4 },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "cost.margin" }),
          expect.objectContaining({ path: "value.realizationFactor" }),
        ]),
      );
    }
  });

  it("reports path-based errors for invalid numeric fields", () => {
    const triten = tritenExample();
    const firstSegment = triten.value.segments[0];
    const firstWorkstream = triten.cost.workstreams[0];
    expect(firstSegment).toBeDefined();
    expect(firstWorkstream).toBeDefined();

    const result = validateProject({
      ...triten,
      client: {
        ...triten.client,
        workingWeeks: 80,
      },
      cost: {
        ...triten.cost,
        workstreams: [
          {
            ...firstWorkstream,
            aiFactor: 0,
            hours: { optimistic: 10, likely: 5, pessimistic: 20 },
          },
        ],
      },
      value: {
        ...triten.value,
        segments: [
          {
            ...firstSegment,
            headcount: -1,
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "client.workingWeeks" }),
          expect.objectContaining({ path: "cost.workstreams[0].aiFactor" }),
          expect.objectContaining({ path: "cost.workstreams[0].hours" }),
          expect.objectContaining({ path: "value.segments[0].headcount" }),
        ]),
      );
    }
  });
});
