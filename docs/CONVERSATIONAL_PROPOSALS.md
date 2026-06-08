# Conversational proposal flow

ScopeForge's collaborative proposal workflow is chat-assisted, not
chat-sourced. Partners can use conversation, website brand extraction, manual
edits, preview, and export to move faster, but the canonical project state is
the latest structured source-of-truth JSON: a `ProposalDraft`, a vendor
`ProposalBrand`, and a client `ProposalBrand`.

## Product flow

1. **Create or select a proposal project.** A project starts from a starter
   draft, `ProposalIntake`, or full `sourceOfTruth`. Version 1 stores the
   reviewed draft/brand JSON plus hashes and brand snapshots.
2. **Collaborate through chat and manual edits.** The assistant may ask
   questions, transform notes, import website-derived brands, and propose typed
   changes, but accepted changes are committed back to the project source of
   truth. Chat messages and prompts are provenance, not state.
3. **Start fresh chats from latest state.** When a partner wants less model
   context or joins later, start a fresh chat from the latest project version
   instead of extending an old session. The server hydrates the new chat from
   the newest structured JSON, so the partner gets current draft and brand
   state without carrying stale conversation history.
4. **Validate before analysis.** Runtime validation checks the draft, vendor
   brand, and client brand before running pricing math or rendering.
5. **Analyze deterministically.** Valid drafts produce a `Project` and call
   `analyzeProject(project, { seed, iterations })`. AI output never changes
   cost/value/pricing math after the draft is fixed.
6. **Render and export locally.** The local Node app server renders branded HTML
   and exports PDFs with Playwright. Artifacts record their source project
   version, content hashes, renderer metadata, audience, seed, and iterations.

## Source of truth: draft and brand JSON

A proposal project's current version owns a `sourceOfTruth` object:

- `draft`: the reviewed `ProposalDraft` that contains the engine `project`,
  prepared-for details, recommendation narrative, value proposal, build plan,
  deliverables, pricing phases, terms, footer, and next steps.
- `vendorBrand`: the seller/partner brand profile used for proposal styling.
- `clientBrand`: the client brand profile used for client identity and accents.

All downstream steps read from this structured JSON. The renderer should never
depend on raw chat transcripts, unreviewed website claims, or model memory. To
recover the latest state, fetch the project, read `currentVersion.sourceOfTruth`,
and re-run `validate → analyzeProject(seed, iterations) → render HTML → export
PDF`.

Website-derived brands are also reviewed JSON. Capture source URLs, fetched
timestamps, extracted assets, color tokens, confidence notes, and manual
overrides as provenance, then persist the approved brand profile. If the website
changes later, existing proposal versions remain replayable from the stored
brand JSON and hashes.

## Versioning and conflict handling

Each proposal project stores immutable versions with `versionId`,
`versionNumber`, optional `parentVersionId`, `createdBy`, source/reason labels,
source-of-truth JSON, and hashes for the draft, vendor brand, client brand, and
combined source.

Every write-like collaborative action should include the base version it was
built from:

- project updates use `baseVersionId` or `baseVersion`;
- website brand imports use `baseVersionId`;
- project-backed agent messages use `projectId` plus `baseVersion`;
- POST previews and PDF exports use `baseVersionId` so artifacts are tied to the
  intended current version.

If the base is stale, the API returns `409` with `code: "base_version_conflict"`
and `latestProject` metadata. Do not silently overwrite. Fetch the latest
project state, inspect what changed, reapply the partner's intended edit against
the new current version, and retry with the latest base version.

For context management, a partner can intentionally start a new chat from the
latest project state (`newChatFromLatestProject: true` in the agent-message API,
or the matching UI action). That discards the old chat context and hydrates the
new session from the current source-of-truth JSON.

## PDFs and HTML are versioned artifacts

PDFs are shareable outputs, not the canonical state. The local project store
saves proposal previews, rendered HTML, and PDFs as artifacts under the project
record (by default in `.scopeforge/proposal-projects/`). Each artifact records:

- the source `versionId` and combined source hash;
- draft, vendor-brand, and client-brand hashes;
- audience (`client` or `internal`), template, renderer, renderer version,
  generated timestamp, analysis seed, and iteration count;
- file metadata such as URI, filename, MIME type, byte count, and artifact hash.

When the draft or brand JSON changes, export a new artifact from the new version
instead of editing an old PDF. This keeps PDFs auditable and lets partners prove
which exact source JSON produced each client-facing file.

## Local setup

Install dependencies, then run the collaborative app through the Node app server:

```bash
npm install
npm run app:dev
```

`npm run app:dev` serves the Vite UI and local `/api/*` routes on one origin
(default `http://127.0.0.1:4174`). Use this URL for collaborative projects,
agent messages, website brand extraction, preview, and PDF export; the Vite-only
server does not provide the privileged local API routes.

Live agent calls are optional. Leave `SCOPEFORGE_AGENT_ENABLED=false` or unset to
run without model calls. To enable the local proposal copilot, export the
optional `SCOPEFORGE_AGENT_*` variables before starting the server, or use Node
24's env-file support with a copied `.env`:

```bash
cp .env.example .env
# Fill SCOPEFORGE_AGENT_PROVIDER, SCOPEFORGE_AGENT_MODEL, and an API key.
node --env-file=.env --import tsx src/server/appServer.ts --dev-ui
```

Common scoped variables are `SCOPEFORGE_AGENT_ENABLED`,
`SCOPEFORGE_AGENT_PROVIDER`, `SCOPEFORGE_AGENT_MODEL`,
`SCOPEFORGE_AGENT_API_KEY`, `SCOPEFORGE_AGENT_BASE_URL`,
`SCOPEFORGE_AGENT_MAX_TOKENS`, `SCOPEFORGE_AGENT_TEMPERATURE`,
`SCOPEFORGE_AGENT_TOP_P`, `SCOPEFORGE_AGENT_THINKING`,
`SCOPEFORGE_AGENT_CACHE_RETENTION`, `SCOPEFORGE_AGENT_WEB_SEARCH`,
`SCOPEFORGE_AGENT_COMPACTION`, `SCOPEFORGE_AGENT_CLEAR_TOOL_USES`, and
`SCOPEFORGE_AGENT_PROMPT_CACHE_KEY`. Keep these server-side; never expose secrets
through `VITE_*` variables. See `.env.example` and
[Agent LLM configuration](AGENT_LLM_CONFIG.md) for provider-specific API-key
fallbacks.

## Local API shape

The current local collaboration routes are:

- `GET /api/proposal-projects` and `POST /api/proposal-projects` to list/create
  proposal projects;
- `GET /api/proposal-projects/:projectId` to fetch latest state;
- `PATCH|PUT /api/proposal-projects/:projectId` for base-versioned source JSON
  updates;
- `GET /api/proposal-projects/:projectId/versions` for immutable version
  history;
- `GET /api/proposal-projects/:projectId/updates` for latest version/artifact
  summary metadata;
- `POST /api/proposal-projects/:projectId/brands/import` to import a vendor or
  client website brand against a base version;
- `GET|POST /api/proposal-projects/:projectId/preview` to render the latest
  branded HTML preview;
- `POST /api/proposal-projects/:projectId/export-pdf` to export and version a
  PDF artifact;
- `POST /api/agent/messages` for local agent SSE messages, optionally tied to a
  project/base version.

All expected failures return typed JSON errors. Client-facing preview/PDF export
blocks on guardrail errors and should omit internal cost floors, margins, risk
pads, raw prompts, and unreviewed website claims.

## Collaborative E2E tests

Run the collaboration workflow test with:

```bash
npm run test:e2e:collab
```

Equivalent direct Vitest command:

```bash
npm test -- src/server/collaborativeProposalWorkflow.test.ts
```

The test starts a local app server with fake agent, brand-extraction, and PDF
renderer dependencies, so it does not need live API keys or Playwright Chromium.
It verifies project creation, vendor/client brand imports, partner A edits,
partner B starting a fresh chat from latest state, stale-base conflict handling,
preview/PDF artifact creation, and reload from persisted project JSON.

## Client-safe guardrails

Client exports must block on guardrail errors and should only include client-safe
warnings. Internal-only data includes cost floors, margin, risk pads, AI
rationale, raw prompts, and unreviewed website findings. Client-visible claims
need either structured draft support, explicit user approval, or source
provenance.
