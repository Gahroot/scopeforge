# ScopeForge

Turns a vague build request into a defensible, honest scope and price. Three-lens model: cost floor, value ceiling, market reconciliation.

## Install

```bash
npm install
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check then produce the production build (`tsc && vite build`). |
| `npm run test` | Run the Vitest suite once. |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`). |

`npm run test:watch` and `npm run preview` are also available.

## Usage

The public API is exported from [`src/core/index.ts`](src/core/index.ts). The
entry point is `analyzeProject(project, opts?)`, which runs all three lenses plus
guardrails deterministically and returns an `Analysis`.

```ts
import { analyzeProject } from "scopeforge";
import type { Project } from "scopeforge";

const project: Project = {
  project: "Ops dashboard",
  client: {
    sizeHeadcount: 40,
    buyerRole: "Head of Operations",
    workingWeeks: 48,
  },
  cost: {
    blendedRate: { optimistic: 90, likely: 110, pessimistic: 140 },
    margin: 0.4,
    workstreams: [
      {
        name: "Data model + reconciliation",
        hours: { optimistic: 30, likely: 50, pessimistic: 90 },
        aiFactor: 1,
        judgment: true,
      },
      {
        name: "UI build",
        hours: { optimistic: 40, likely: 60, pessimistic: 100 },
        aiFactor: 0.5,
        judgment: false,
      },
    ],
  },
  value: {
    realizationFactor: { low: 0.4, high: 0.7 },
    segments: [
      { role: "Analyst", headcount: 3, hoursPerWeek: 6, loadedRate: 65 },
    ],
    workflows: [
      { name: "Monthly close", low: 4000, high: 9000 },
    ],
    futureUpside: [
      { name: "Avoided hire", low: 60000, high: 90000, note: "later phase" },
    ],
  },
  pricing: {
    valueFraction: { low: 0.1, high: 0.2 },
    tiers: [
      { name: "Core", price: 18000 },
      { name: "Plus", price: null, note: "scoped later" },
    ],
  },
};

// opts is optional: { seed?: number; iterations?: number }. Defaults are fixed
// so output is reproducible.
const analysis = analyzeProject(project, { seed: 7 });

console.log(analysis.cost.riskAdjustedFloorP90);
console.log(analysis.value.yearOne);
console.log(analysis.pricing.targetBand);
console.log(analysis.warnings);
```

Individual lens functions (`runCost`, `runValue`, `runPricing`),
`checkGuardrails`, and helpers (`makeRng`, `triangular`, `percentile`,
`percentiles`) are also re-exported from the same entry point.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the three-lens methodology
and how the engine is structured.
