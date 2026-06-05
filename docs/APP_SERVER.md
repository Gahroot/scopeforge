# Local app server

ScopeForge includes a local Node app server for the Vite UI and privileged server-side work. The browser should call this server instead of importing future model providers, website fetchers, file writers, or PDF renderers directly.

## Development

```bash
npm run app:dev
```

`app:dev` starts the Node server on `http://127.0.0.1:4174` and mounts Vite in middleware mode, so the UI and `/api/*` routes share one origin.

Useful flags:

```bash
npm run app:dev -- --host 127.0.0.1 --port 4174
npm run app:dev -- --dev-ui --root /path/to/scopeforge
```

## Built UI server

```bash
npm run build
npm run app:server
```

`app:server` serves built Vite assets from `dist/` and keeps the same API routes available. Use `--static-dir path/to/dist` to point at a different build output.

## API routes

All routes are local-only by default, return `Cache-Control: no-store`, and do not expose environment variables or provider credentials to the browser.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/health` | `GET` | Server status and capability list. |
| `/api/brands` | `GET` | Built-in public brand profiles. |
| `/api/brands/validate` | `POST` | Validate a custom brand profile. |
| `/api/proposals/validate` | `POST` | Validate a `ProposalIntake`, `ProposalDraft`, `{ intake }`, or `{ draft }`. |
| `/api/proposals/analyze` | `POST` | Validate and run deterministic analysis for a `Project`, proposal intake, or draft. |
| `/api/proposals/preview` | `POST` | Render proposal HTML from reviewed structured input. |
| `/api/proposals/export-pdf` | `POST` | Validate draft/intake + template + brand, render HTML, and return a PDF response from server-side Playwright. |
| `/api/agent/messages` | `POST` | Reserved placeholder for future local model calls. |
| `/api/brand/from-website` | `POST` | Reserved placeholder for future server-side website brand extraction. |

Preview/PDF requests accept a `ProposalIntake`, `ProposalDraft`, `{ intake }`, or `{ draft }` plus options such as `templateId` (`generic/value-proposal` or `generic/scope-review`), `brand` or `brandId`, `audience` (`client` or `internal`), `seed`, `iterations`, `generatedAt`, and PDF `fileName`/`format`. Client-audience preview and export block on guardrail errors; use `audience: "internal"` only for local review.

PDF export uses Playwright Chromium. If Chromium is missing, the API returns `chromium_missing` with the install command. Install it once:

```bash
npx playwright install chromium
```
