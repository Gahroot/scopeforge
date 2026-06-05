/**
 * Default project + the Triten engagement as a real fixture.
 * Numbers mirror the final agreed model (METHODOLOGY.md): $40K pilot,
 * ~$100–170K year-one value, ~5-month payback.
 */

import type { Project } from "../core/types.js";

export function createDefaultProject(): Project {
  return {
    project: "Untitled",
    client: { sizeHeadcount: 0, buyerRole: "", workingWeeks: 46 },
    cost: {
      blendedRate: { optimistic: 120, likely: 150, pessimistic: 185 },
      margin: 0.4,
      workstreams: [],
    },
    value: {
      realizationFactor: { low: 0.45, high: 0.55 },
      segments: [],
      workflows: [],
      futureUpside: [],
    },
    pricing: {
      valueFraction: { low: 0.1, high: 0.2 },
      tiers: [],
    },
  };
}

/** The Triten pilot, as actually scoped. Used as an example and in tests. */
export function tritenExample(): Project {
  return {
    project: "Triten",
    client: { sizeHeadcount: 45, buyerRole: "COO", workingWeeks: 46 },
    // Cost workstreams scoped to the actual PILOT (not full Phase 1).
    // Lands ~$12–18K labor cost → ~$20–30K floor, comfortably under the $40K price.
    cost: {
      blendedRate: { optimistic: 120, likely: 150, pessimistic: 185 },
      margin: 0.4,
      workstreams: [
        { name: "Discovery + data model", hours: { optimistic: 18, likely: 28, pessimistic: 45 }, aiFactor: 1, judgment: true },
        { name: "Data layer + ingestion (Power BI + Monday)", hours: { optimistic: 20, likely: 34, pessimistic: 55 }, aiFactor: 0.55, judgment: false },
        { name: "MCP server + Q&A", hours: { optimistic: 24, likely: 38, pessimistic: 62 }, aiFactor: 0.55, judgment: false },
        { name: "QA + reconciliation", hours: { optimistic: 14, likely: 22, pessimistic: 38 }, aiFactor: 1, judgment: true },
        { name: "Docs + handoff", hours: { optimistic: 8, likely: 13, pessimistic: 22 }, aiFactor: 0.55, judgment: false },
      ],
    },
    value: {
      realizationFactor: { low: 0.45, high: 0.55 },
      segments: [
        { role: "Analysts & associates", headcount: 7, hoursPerWeek: 2.5, loadedRate: 75 },
        { role: "Asset managers & PMs", headcount: 6, hoursPerWeek: 2, loadedRate: 85 },
        { role: "Internal finance & ops", headcount: 5, hoursPerWeek: 1.5, loadedRate: 70 },
        { role: "Execs & principals", headcount: 4, hoursPerWeek: 1, loadedRate: 175 },
      ],
      workflows: [
        { name: "Investor-report assembly", low: 5000, high: 15000 },
        { name: "Underwriting metric extraction", low: 15000, high: 30000 },
        { name: "Pipeline & inspection entry", low: 10000, high: 20000 },
      ],
      futureUpside: [
        { name: "Avoided analyst hire", low: 80000, high: 120000, note: "later phase" },
        { name: "Accounting automation", low: 60000, high: 120000, note: "future phase" },
      ],
    },
    pricing: {
      valueFraction: { low: 0.1, high: 0.2 },
      tiers: [
        { name: "Pilot Build", price: 40000 },
        { name: "Phase 2 — AI Agent + Workflows", price: null, note: "scoped after the pilot" },
      ],
    },
  };
}
