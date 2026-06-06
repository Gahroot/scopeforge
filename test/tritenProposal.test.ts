import { describe, expect, it } from "vitest";

import { parseProposal } from "../src/proposal/schema.js";
import { tritenProposal } from "../src/data/tritenProposal.js";

describe("tritenProposal", () => {
  it("produces a document that parses through the proposal boundary schema", () => {
    // Arrange
    const proposal = tritenProposal();

    // Act
    const parsed = parseProposal(proposal);

    // Assert
    expect(parsed.meta.vendor).toBe("Black Mountain Solutions");
    expect(parsed.meta.recipient).toBe("Brent Ozenbaugh and the Triten Team");
    expect(parsed.meta.engagement).toBe("Phase 1: Foundational Infrastructure");
    expect(parsed.meta.date).toBe("June 5, 2026");
    expect(parsed.meta.confidential).toBe(true);
  });

  it("carries the headline savings target and payback", () => {
    // Arrange
    const proposal = tritenProposal();

    // Act
    const { headline } = proposal;

    // Assert
    expect(headline.savingsTarget).toBe("$150K-180K/yr");
    expect(headline.payback).toBe("~6 mo");
    expect(headline.summary.length).toBeGreaterThan(0);
  });

  it("models the discounted three-phase pricing and continuing support", () => {
    // Arrange
    const proposal = tritenProposal();

    // Act
    const { tiers, phases, terms } = proposal.project.pricing;

    // Assert
    expect(tiers[0]).toMatchObject({ price: 50000, standardPrice: 75000, discountPct: 0.33 });
    expect(phases?.map((phase) => phase.status)).toEqual(["fixed", "estimated", "open"]);
    expect(phases?.[1]?.price).toBe(100000);
    expect(phases?.[2]?.price).toBeNull();
    expect(terms?.supportMonthly).toBe(3000);
    expect(terms?.usageBilledSeparately).toBe(true);
  });

  it("includes the multi-year savings ramp and authored narrative", () => {
    // Arrange
    const proposal = tritenProposal();

    // Act
    const { ramp } = proposal.project.value;

    // Assert
    expect(ramp?.map((year) => year.year)).toEqual([1, 2, 3]);
    expect(ramp?.[0]).toMatchObject({ low: 150000, high: 180000 });
    expect(proposal.unlocks.length).toBeGreaterThan(0);
    expect(proposal.whatWeBuild.length).toBeGreaterThan(0);
    expect(proposal.deliverables[0]?.bullets?.length).toBe(6);
  });
});
