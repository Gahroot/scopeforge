# Conversational proposal flow

ScopeForge's target product experience is a chat-driven proposal builder that turns rough notes, client calls, and websites into a reviewed proposal draft. The chat helps collect and refine inputs, but the source of truth is always structured data that can be validated, analyzed, rendered, and exported deterministically.

## Product flow

1. **Start from a conversation.** The user pastes notes, uploads a meeting summary, or gives a client/seller website URL. The assistant asks only for missing scope, value, pricing, delivery, or brand facts.
2. **Patch a structured draft.** Every assistant turn proposes typed patches to a `ProposalDraft`; chat messages are provenance, not state. Manual edits update the same draft.
3. **Validate before analysis.** Runtime validation checks required client metadata, narrative, scope, milestones, assumptions, exclusions, value inputs, priced tiers, and brand fields.
4. **Analyze deterministically.** Valid drafts produce a `Project` and call `analyzeProject(project, { seed, iterations })`; AI output never changes cost/value/pricing math after the draft is fixed.
5. **Render from the draft.** The proposal view model is built from the draft, analysis, audience, and brand profile, then rendered to HTML with stable formatting.
6. **Export locally.** The Node service writes HTML/PDF artifacts, including draft hash, analysis seed, renderer version, and audience so output is replayable.

## Structured draft as source of truth

`ProposalDraft` should be the future app-level object that wraps the current `ProposalIntake` with workflow metadata:

- `project`: ScopeForge `Project` engine input for cost, value, and pricing.
- `preparedFor`, `details`, `scope`, `milestones`, `assumptions`, `exclusions`, `clientInputs`, `nextSteps`: current proposal-intake sections.
- `brandProfile`: selected built-in/custom profile or a website-derived profile approved by the user.
- `status`: draft completeness, validation errors, guardrail state, export history.
- `provenance`: source notes, website URLs, agent prompts, and accepted/rejected patches.

All downstream steps read from this draft. The agent may suggest changes, but validation and rendering should never depend on raw chat transcripts.

## Local Node agent service

The browser client should stay secret-free and call a localhost Node service for privileged or nondeterministic work:

- AI/model calls that convert notes into typed draft patches.
- Website fetching and brand-profile extraction.
- Draft file persistence/import/export.
- Playwright HTML-to-PDF export.

Suggested local API shape: `POST /agent/messages`, `GET/PUT /draft`, `POST /brand/from-website`, `POST /validate`, `POST /analyze`, `POST /render`, and `POST /export`. Responses should be typed JSON results; expected failures return validation errors rather than throwing.

## Website-derived brand profiles

A brand profile can be generated from a public website, then reviewed before use. Capture source URLs, fetched timestamp, extracted logo text/assets, color tokens, typography hints when available, and confidence notes. Persist the approved profile as JSON so render/export remain deterministic even if the website later changes.

## Client-safe guardrails

Client exports must block on guardrail errors and should only include client-safe warnings. Internal-only data includes cost floors, margin, risk pads, AI rationale, raw prompts, and unreviewed website findings. Client-visible claims need either structured draft support, explicit user approval, or source provenance.
