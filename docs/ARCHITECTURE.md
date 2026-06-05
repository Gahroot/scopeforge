# ScopeForge — Architecture

A tool that turns a vague "build us a system" into a defensible, honest price.
It does **not** invent a number — it enforces discipline: real inputs, honest value
attribution, footed tables, and a floor you won't go below.

The full reasoning behind the math lives in
`../../scope_pricing_tool/METHODOLOGY.md`. This doc covers *how the code is structured*.

## Layers (dependencies point inward only)

```
┌─────────────────────────────────────────────┐
│  ui/        screens, DOM, charts (outer)     │   ← depends on app + core
│  render/    proposal HTML → PDF pipeline      │
├─────────────────────────────────────────────┤
│  app/       store, orchestration             │   ← depends on core + data
│  data/      schema, defaults, persistence    │
├─────────────────────────────────────────────┤
│  core/      DOMAIN ENGINE (pure, framework-   │   ← depends on NOTHING
│             free, deterministic, tested)      │
└─────────────────────────────────────────────┘
```

**The rule:** `core/` imports nothing outside itself — no DOM, no storage, no Date.now(),
no Math.random(). All randomness is injected (seeded RNG). This makes the engine
deterministic and unit-testable, and lets it run identically in a browser, a Node script,
or a future server.

## Modules

### `core/` — the engine (the crown jewel)
| File | Responsibility |
|---|---|
| `types.ts` | All domain types. Single source of truth for shapes. |
| `random.ts` | Seeded RNG (mulberry32) + triangular sampler. Injected everywhere. |
| `stats.ts` | Percentiles, sums. No domain knowledge. |
| `cost.ts` | Lens A — bottom-up Monte Carlo cost floor. |
| `value.ts` | Lens B — top-down first-year value, auto-footed. |
| `pricing.ts` | Lens C — value-fraction anchor, payback, reconciliation. |
| `guardrails.ts` | The five rules, encoded as warnings. |
| `index.ts` | Barrel + `analyzeProject()` that runs all three lenses. |

### `data/` — shapes & storage
- `schema.ts` — runtime validation of a Project (no external dep).
- `defaults.ts` — `createDefaultProject()` + the Triten example as a fixture.
- `persistence.ts` — localStorage save/load/list + JSON import/export. Browser-guarded.

### `app/` — orchestration
- `store.ts` — tiny observable store (subscribe/dispatch). No framework lock-in.

### `ui/` + `render/` — outer shells (built on top of the proven core)
- UI screens drive the engine and show live results.
- `render/` reuses the headless-Chromium proposal→PDF pipeline from the Triten run.

## Why this shape
- **Testability:** every number the business depends on is a pure function with a seeded
  RNG → exact, repeatable assertions.
- **Portability:** the engine has zero I/O, so it runs in browser or CI unchanged.
- **Honesty by construction:** guardrails live *in the core*, not the UI, so no screen can
  bypass them (e.g., a table that doesn't foot, or future-upside counted in payback).
