# ScopeForge — Architecture

A tool that turns a vague "build us a system" into a defensible, honest price.
It does **not** invent a number — it enforces discipline: real inputs, honest value
attribution, footed tables, and a floor you won't go below.

The full reasoning behind the math lives in
`../../scope_pricing_tool/METHODOLOGY.md`. This doc covers *how the code is structured*.

## Layers (dependencies point inward only)

```
┌────────────────────────────────────────────────────────┐
│  browser UI      chat, draft editor, preview           │  ← no secrets
├────────────────────────────────────────────────────────┤
│  local Node      agent/model calls, website fetch,      │  ← outer I/O
│  agent service   draft files, Playwright PDF export     │
├────────────────────────────────────────────────────────┤
│  proposal/app    structured draft, validation,          │  ← deterministic once
│  render          view model, HTML rendering             │     draft is fixed
├────────────────────────────────────────────────────────┤
│  core            DOMAIN ENGINE: pure, framework-free,   │  ← depends on nothing
│                  deterministic, tested                  │
└────────────────────────────────────────────────────────┘
```

**The rule:** `core/` imports nothing outside itself — no DOM, no storage, no `Date.now()`,
no `Math.random()`. All randomness is injected with a seeded RNG. This makes the engine
repeatable in browser preview, the local Node service, CI, and future hosted variants.

The conversational agent is intentionally outside the deterministic boundary. It may turn
notes into draft patches, but it must not compute pricing math or render client output
from raw chat state.

## Target product flow

1. **Chat-driven drafting:** users paste notes, answer clarifying questions, or provide URLs.
2. **Structured draft source of truth:** accepted assistant/manual edits patch a typed proposal
   draft; chat transcripts are provenance only.
3. **Deterministic pipeline:** validate the draft, derive the `Project`, run `analyzeProject`
   with explicit seed/iterations, build a proposal view model, render HTML, then export PDF.
4. **Website-derived brand profiles:** the local Node service can fetch public websites and
   propose brand colors/logo text/contact details; approved profiles are persisted as JSON.
5. **Client-safe guardrails:** client exports block on guardrail errors and hide internal cost
   floors, margins, risk pads, raw prompts, and unreviewed claims.

See [`CONVERSATIONAL_PROPOSALS.md`](CONVERSATIONAL_PROPOSALS.md) for implementer details.

## Modules

### `core/` — the engine (the crown jewel)
| File | Responsibility |
|---|---|
| `types.ts` | All domain types. Single source of truth for engine shapes. |
| `random.ts` | Seeded RNG (mulberry32) + triangular sampler. Injected everywhere. |
| `stats.ts` | Percentiles, sums. No domain knowledge. |
| `cost.ts` | Lens A — bottom-up Monte Carlo cost floor. |
| `value.ts` | Lens B — top-down first-year value, auto-footed. |
| `pricing.ts` | Lens C — value-fraction anchor, payback, reconciliation. |
| `guardrails.ts` | Methodology rules encoded as warnings/errors. |
| `index.ts` | Public exports + `analyzeProject()` that runs all three lenses. |

### `data/`, `proposal/`, `render/` — deterministic proposal pipeline
- `data/schema.ts` validates engine `Project` input without external dependencies.
- `proposal/types.ts` and `proposal/schema.ts` define and validate structured proposal intake.
- `proposal/model.ts` combines intake, brand, audience, and analysis into a view model.
- `render/proposalHtml.ts` renders stable HTML; `render/pdf.node.ts` exports PDF in Node.

### `app/` + `ui/` — browser experience
- Browser UI should drive chat, draft editing, validation, and preview.
- It should never hold AI provider secrets or perform privileged website/PDF work.

### Local Node agent service — target outer shell
- Owns AI/model calls, website-derived brand profiles, draft file persistence, and exports.
- Returns typed JSON patches/results to the UI; expected failures surface as validation errors.
- Persists draft hash, analysis seed, audience, and renderer version with each export.

## Why this shape
- **Testability:** every number the business depends on is a pure function with a seeded RNG.
- **Replayability:** after a draft and brand profile are approved, validate/analyze/render/export
  can be rerun byte-for-byte or diffed with explicit version/hash metadata.
- **Portability:** the engine has zero I/O, so it runs in browser or CI unchanged.
- **Honesty by construction:** guardrails live in core/proposal validation, not just the UI,
  so no screen or agent can bypass missing economics or unsafe client output.
