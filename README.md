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
| `npm run app:dev` | Start the local Node app server with Vite mounted behind it. |
| `npm run app:server` | Serve the built Vite UI from `dist/` with local API routes. |
| `npm run build` | Type-check then produce the production build (`tsc && vite build`). |
| `npm run test` | Run the Vitest suite once. |
| `npm run test:e2e:collab` | Run the collaborative proposal-project E2E workflow test. |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`). |
| `npm run proposal` | Generate proposal PDF/HTML from intake JSON. |
| `npm run proposal:sample` | Generate the Triten sample proposal into `out/`. |

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

ScopeForge is for pricing outcome-based pilots/builds, not selling paid
"discovery" or "scoping" sprints as the lead offer. The guardrails flag lead
tiers that look like paid discovery so the first paid engagement stays tied to a
client-visible result.

## Proposal generation

Use the local proposal workflow when you have structured intake JSON from a
meeting-summary AI or manual scoping pass:

```bash
npm run app:dev
npm run proposal -- --input examples/proposals/triten-intake.json --brand nolan --out out/triten-proposal.pdf --html out/triten-proposal.html
```

The browser app previews branded HTML, validates missing scope/value/pricing
inputs, downloads HTML, and calls the local Node `/api/proposals/export-pdf`
route from **Download PDF**. Open the app-server URL from `npm run app:dev`
instead of the Vite-only URL when exporting PDFs. The browser API and CLI both
render with Playwright Chromium; if Chromium is missing, run
`npx playwright install chromium` once.

## Collaborative proposal projects

Run the collaborative app locally with the Node app server:

```bash
npm run app:dev
```

Agent/model calls are optional. Leave `SCOPEFORGE_AGENT_ENABLED=false` or unset
for draft/project APIs without live model calls, or export the optional
`SCOPEFORGE_AGENT_*` variables from [`.env.example`](.env.example) before
starting the server. Keep secrets server-side; do not put them in `VITE_*`
variables.

A proposal project is versioned around structured JSON, not the chat transcript.
The latest `sourceOfTruth` contains the reviewed `draft`, `vendorBrand`, and
`clientBrand`; those draft/brand JSON objects drive validation, analysis,
rendering, and export. HTML previews and PDFs are saved as versioned artifacts
with source version/hash metadata, so a PDF is a replayable output, not the
canonical state.

Partners can manage chat context by starting a fresh chat from the latest
project version instead of carrying an old thread forever. Each update, brand
import, agent message, preview, or PDF export should include the base version it
was created from; stale bases return a `base_version_conflict` with the current
project metadata so the partner can fetch latest state and retry deliberately.

Run the collaborative E2E workflow test with:

```bash
npm run test:e2e:collab
```

Detailed docs:

- [Local app server](docs/APP_SERVER.md)
- [Proposal generation workflow](docs/PROPOSAL_GENERATION.md)
- [Collaborative conversational proposal flow](docs/CONVERSATIONAL_PROPOSALS.md)
- [Meeting summary to proposal-intake prompt](docs/MEETING_SUMMARY_TO_PROPOSAL_PROMPT.md)

## Target conversational flow

The chat-driven layer is a local collaborative drafting experience. The
assistant may ask questions, transform notes, and derive brand profiles from
public websites, but accepted changes patch structured project source-of-truth
JSON (`draft`, `vendorBrand`, and `clientBrand`). A local Node agent service
handles model calls, website fetches, local project files, and Playwright export
so the browser stays client-safe and secret-free.

From fixed draft/brand JSON, ScopeForge runs the deterministic sequence:
`validate → analyzeProject(seed, iterations) → render HTML → export PDF`. Client
exports block on guardrail errors and omit internal cost floors, margins, risk
pads, raw prompts, and unreviewed website claims.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the three-lens methodology
and how the engine is structured.
