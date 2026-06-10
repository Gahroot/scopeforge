# AGENTS.md

Guidance for coding agents working in the ScopeForge repo.

## Project

ScopeForge turns a vague build request into a defensible, honest scope and price using a three-lens model: cost floor, value ceiling, market reconciliation.

## Stack

- TypeScript ESM (`"type": "module"`), Node >= 24
- Deterministic core engine (`src/core`) + Node app server (`src/server`) + React 18 UI (`src/ui`, Tailwind + shadcn-style) + agent copilot (`src/agent`) + CLI (`src/cli`)
- Vite for build/dev, Vitest for tests, Biome for lint/format, Zod v4 at boundaries
- Strict `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`

## Commands

- `npm run dev` — Vite dev server (UI only)
- `npm run app:dev` — app server with Vite mounted behind it
- `npm run build` — `vite build && tsc` (emits `dist/`, including the CLI bin)
- `npm run preview` — preview the build
- `npm test` — run tests once (`vitest run`)
- `npm run test:watch` — Vitest in watch mode
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Biome lint; `npm run format` / `npm run format:check` — Biome format

## Conventions (as used in `src/`)

- **Named exports only** — no default exports (see `src/core/index.ts`).
- **Explicit return types** on exported functions.
- **`.js` import specifiers** for local ESM imports (e.g. `import { makeRng } from "./random.js"`), required by `verbatimModuleSyntax` / bundler resolution.
- **Deterministic core** — the engine never calls `Math.random()`. Samplers take an injected seeded RNG (`makeRng`, mulberry32) so results are exact and repeatable in tests and CI. `analyzeProject` accepts an optional `seed` (fixed default) for reproducible output.
- **`exactOptionalPropertyTypes`** — build objects with conditional spreads (`...(x === undefined ? {} : { x })`); never assign `undefined` to an optional property.
- **No `any`, no non-null `!` assertions** — Biome enforces both; guard and throw instead.
- **Zod v4** — validation failures expose `error.issues` (there is no `error.errors`).
- **Escape all render output** — user data in `src/render` goes through `htmlEscape`; CSS colors through `safeCssColor`.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
