# CLAUDE.md

ScopeForge is a deterministic TypeScript engine that turns a structured build request into a defensible scope and price via a three-lens model: cost floor → value ceiling → pricing reconciliation, with methodology guardrails.

## Current state

Engine-only. Despite the Vite setup (`dev`/`build`/`preview` scripts), there is **no UI, CLI, or server** — no `index.html`, `main.ts`, or components. The shipped surface is the pure `src/core` library. `package.json` has no `bin`, `main`, or `exports` field.

## Structure

- `src/core/index.ts` — public entry. `analyzeProject(project, opts)` orchestrates the three lenses + guardrails; re-exports the whole surface.
- `src/core/types.ts` — single source of truth for all data shapes (`Project`, `CostModel`, `ValueModel`, `PricingModel`, `Analysis`). Leaf module, no imports.
- `src/core/cost.ts` — Lens A. Monte-Carlo cost floor (triangular sampling, AI factors, margin). `DEFAULT_ITERATIONS` = 50,000; `CORRELATION_RISK_PAD` = 0.18.
- `src/core/value.ts` — Lens B. First-year realized value; keeps `futureUpside` out of payback.
- `src/core/pricing.ts` — Lens C. Value-fraction price anchor + payback months; `leadPrice` helper.
- `src/core/guardrails.ts` — methodology rules encoded as `Warning[]`. Lives in core by design so no UI can bypass them.
- `src/core/random.ts`, `src/core/stats.ts` — shared primitives (mulberry32 `makeRng` + `triangular`; `percentile`/`sum`).
- `src/data/defaults.ts` — `createDefaultProject()` + `tritenExample` fixture (a real engagement, used as test basis).
- `docs/ARCHITECTURE.md` — three-lens methodology rationale.

## Determinism (project invariant)

The core never calls `Math.random()`. All sampling takes an injected seeded `Rng`; `analyzeProject` defaults `seed` to `7`. Output must stay exactly reproducible in tests/CI — preserve this when touching `cost.ts`, `random.ts`, or `index.ts`.

## Commands

- `npm run dev` / `npm run build` (`tsc && vite build`) / `npm run preview`
- `npm test` (`vitest run`) — single run
- `npm run test:watch` — Vitest watch
- `npm run typecheck` — `tsc --noEmit`

Node `>=24` required (`.nvmrc` pins `24`). npm (lockfileVersion 3). No lint/format scripts exist.
