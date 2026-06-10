# CLAUDE.md

ScopeForge is a deterministic TypeScript engine that turns a structured build request into a defensible scope and price via a three-lens model: cost floor → value ceiling → pricing reconciliation, with methodology guardrails.

## Current state

Full application: deterministic core engine + Node app server + React UI + agent copilot + CLI (`bin: dist/cli/main.js`). The engine in `src/core` remains the pure, deterministic heart; everything else layers on top of it.

## Structure

- `src/core/` — the deterministic engine. `index.ts` exposes `analyzeProject(project, opts)` (three lenses + guardrails) and `runSensitivity` (one-parameter what-if sweeps). `types.ts` is the leaf source of truth; `cost.ts` (Lens A, Monte-Carlo cost floor, `DEFAULT_ITERATIONS` = 50,000, `CORRELATION_RISK_PAD` = 0.18); `value.ts` (Lens B, keeps `futureUpside` out of payback); `pricing.ts` (Lens C); `guardrails.ts` (methodology rules as `Warning[]`, in core so no UI can bypass them); `random.ts`/`stats.ts` (mulberry32 `makeRng`, `triangular`, `percentile`).
- `src/data/` — `createDefaultProject()` + `tritenExample` fixture; JSON schema validation.
- `src/server/` — Node app server (`appServer.ts`), HTTP routes (`routes.ts`, includes the `ProposalProjectStore` interface), agent SSE streaming (`agentStream.node.ts`), batch ingestion (`batch.ts`), share-link engagement tracking (`trackingStore.ts`/`trackingScript.ts`).
- `src/agent/` — proposal copilot: provider config/credentials (OAuth for Anthropic/OpenAI under `oauth/`), session state, and the tool belt under `tools/`.
- `src/proposal/` — proposal draft model, hand-rolled validation (`schema.ts`, path-based errors), draft/template stores, built-in templates under `templates/`, acceptance records.
- `src/project/` — versioned on-disk project store (`store.node.ts`, atomic writes, branded ids).
- `src/render/` — HTML/PDF proposal renderers. All user data must pass through `htmlEscape.ts` and colors through `safeCssColor` — these renderers are XSS surface.
- `src/ingest/` — source-material extraction (text/PDF/image) with size limits in `limits.ts`.
- `src/ui/` — React 18 + Tailwind + shadcn-style app (chat, draft preview, projects, ingest, brand).
- `src/cli/` — `scopeforge` CLI + proposal generator.
- `docs/ARCHITECTURE.md` — three-lens methodology rationale.

## Determinism (project invariant)

The core never calls `Math.random()`. All sampling takes an injected seeded `Rng`; `analyzeProject` defaults `seed` to `7`. Output must stay exactly reproducible in tests/CI — preserve this when touching `cost.ts`, `random.ts`, or `index.ts`.

## Commands

- `npm run dev` (Vite UI only) / `npm run app:dev` (app server + Vite) / `npm run build` (`vite build && tsc`) / `npm run preview`
- `npm test` (`vitest run`) — single run; `npm run test:watch` — watch mode
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Biome lint; `npm run format` / `format:check` — Biome format
- `npm run proposal` / `proposal:sample` — proposal PDF/HTML generation

Node `>=24` required (`.nvmrc` pins `24`). npm (lockfileVersion 3).

## Conventions

Strict tsconfig (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`); use conditional spreads (`...(x === undefined ? {} : { x })`) for optional fields. Named exports only, `.js` import specifiers, no `any`, no non-null `!` assertions (Biome enforces). Zod v4: `error.issues`, not `error.errors`.
