# AGENTS.md

Guidance for coding agents working in the ScopeForge repo.

## Project

ScopeForge turns a vague build request into a defensible, honest scope and price using a three-lens model: cost floor, value ceiling, market reconciliation.

## Stack

- TypeScript ESM library (`"type": "module"`), Node >= 24
- Vite for build/dev, Vitest for tests
- Strict `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `tsc && vite build`
- `npm run preview` — preview the build
- `npm test` — run tests once (`vitest run`)
- `npm run test:watch` — Vitest in watch mode
- `npm run typecheck` — `tsc --noEmit`

There are no lint or format scripts in this repo.

## Conventions (as used in `src/`)

- **Named exports only** — no default exports (see `src/core/index.ts`).
- **Explicit return types** on exported functions.
- **`.js` import specifiers** for local ESM imports (e.g. `import { makeRng } from "./random.js"`), required by `verbatimModuleSyntax` / bundler resolution.
- **Deterministic core** — the engine never calls `Math.random()`. Samplers take an injected seeded RNG (`makeRng`, mulberry32) so results are exact and repeatable in tests and CI. `analyzeProject` accepts an optional `seed` (fixed default) for reproducible output.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
