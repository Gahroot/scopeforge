# Proposal generation

ScopeForge can now turn structured proposal-intake JSON into a branded HTML proposal and a Playwright-generated PDF. The workflow stays local and deterministic: the app does not call an AI API, parse raw call transcripts, or invent missing economics.

## Workflow

1. **Ask your meeting-summary AI for structured JSON.** Use [`MEETING_SUMMARY_TO_PROPOSAL_PROMPT.md`](MEETING_SUMMARY_TO_PROPOSAL_PROMPT.md) and give it the meeting notes plus any known pricing, value, scope, and delivery inputs.
2. **Preview locally in the browser.** Run `npm run app:dev`, open the app-server URL, upload or paste the JSON, choose a brand/template/audience, and validate. The iframe preview and HTML download work from the browser.
3. **Export the final PDF from the browser or CLI.** Click **Download PDF** to call the local Node `/api/proposals/export-pdf` route, or run `npm run proposal -- --input path/to/intake.json --brand nolan --out out/client-proposal.pdf --html out/client-proposal.html`.
4. **Review guardrails before sending.** Client output blocks on guardrail errors by default. Use `--audience internal` for an appendix with cost-floor and guardrail details.

## Input shape

The CLI and browser accept a `ProposalIntake` JSON object:

- `project`: existing ScopeForge `Project` engine input, including cost, value, and pricing models.
- `preparedFor`: client/company metadata for the cover.
- `details`: title, recommendation, executive summary, and what-we-heard narrative.
- `scope`: client-facing scope items with deliverables and optional outcomes.
- `milestones`: delivery phases and timing.
- `assumptions`, `exclusions`, `clientInputs`, `nextSteps`: client-safe working-agreement lists.

See [`../examples/proposals/triten-intake.json`](../examples/proposals/triten-intake.json) for a complete example.

## Browser preview

```bash
npm run app:dev
```

The browser workflow is intentionally internal:

- Upload or paste `ProposalIntake`, `ProposalDraft`, `{ intake }`, or `{ draft }` JSON.
- Choose `nolan` or `partners` brand.
- Choose `generic/value-proposal` or `generic/scope-review` template.
- Choose `client` or `internal` audience.
- Validate and preview the proposal HTML in an iframe.
- Download HTML, click **Download PDF** for server-side Playwright export, or use browser print for a quick draft.

If you run the Vite-only `npm run dev` command, HTML preview/download still work, but PDF export is unavailable because `/api/proposals/export-pdf` lives on the local Node app server.

## CLI usage

```bash
npm run proposal -- \
  --input examples/proposals/triten-intake.json \
  --brand nolan \
  --audience client \
  --out out/triten-proposal.pdf \
  --html out/triten-proposal.html
```

Supported options:

| Option | Description |
| --- | --- |
| `--input path/to/proposal-intake.json` | Required proposal intake JSON. |
| `--brand nolan\|partners` | Built-in seller brand profile. Defaults to `nolan` when neither brand option is provided. |
| `--brand-file path/to/brand.json` | Custom brand JSON. Mutually exclusive with `--brand`. |
| `--audience client\|internal` | Defaults to `client`. Internal output includes the appendix. |
| `--out out/client-proposal.pdf` | Required PDF output path. |
| `--html out/client-proposal.html` | Optional HTML output path. |
| `--seed 7` | Optional deterministic analysis seed. |
| `--iterations 50000` | Optional Monte Carlo iteration count. |
| `--allow-errors` | Internal/debug-only flag; use with `--audience internal`. Client output still blocks on guardrail errors. |

Sample shortcut:

```bash
npm run proposal:sample
```

## Chromium install

The PDF renderer uses Playwright Chromium. If Chromium is not installed, run:

```bash
npx playwright install chromium
```

Then rerun the CLI command or click **Download PDF** again. HTML preview, iframe print, and HTML download work without Chromium.

## Branding

Built-in brands live in `src/proposal/brands.ts`:

- `nolan`: personal brand preset.
- `partners`: partner/company preset.

You can pass a custom brand file with `--brand-file`. Start from:

- [`../examples/proposals/brand.nolan.example.json`](../examples/proposals/brand.nolan.example.json)
- [`../examples/proposals/brand.partners.example.json`](../examples/proposals/brand.partners.example.json)

Brand colors are used as CSS color tokens. Keep them as hex, named colors, or simple `rgb()`/`hsl()` values.

## Client-safe versus internal audience

`client` output shows:

- Scope, outcomes, milestones, assumptions, exclusions, and next steps.
- Recommended investment.
- Expected year-one value and payback.
- Value-based target range and future upside context.

`internal` output also includes:

- P50/P90 cost floor.
- Risk-adjusted floor.
- Blended rate and target margin.
- Guardrail warnings and analysis details.

Do not send internal output to clients without reviewing it first.

## Troubleshooting

- **Validation errors:** fix the JSON paths shown by the UI/CLI. ScopeForge blocks client output when required project, narrative, pricing, or value fields are missing.
- **Guardrail errors:** revise pricing/scope/economics or render `--audience internal` to inspect the appendix.
- **Missing Chromium:** run `npx playwright install chromium`.
- **Bad JSON:** ask the meeting-summary AI to return only JSON, or paste into a JSON validator before running ScopeForge.
