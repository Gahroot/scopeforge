import type { Tier, Warning } from "../core/types.js";
import type { ProposalMilestone, ProposalScopeItem, ProposalViewModel } from "../proposal/types.js";
import { formatMoney } from "../proposal/format.js";
import { escapeAttribute, escapeHtml } from "./htmlEscape.js";

export function renderProposalHtml(viewModel: ProposalViewModel): string {
  const colors = viewModel.brand.colors;
  const clientAccent = viewModel.preparedFor.accentColor ?? colors.accent;
  const recommendedTierName = viewModel.economics.recommendedTier?.name ?? "Recommended pilot";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(viewModel.details.title)} — ${escapeHtml(viewModel.preparedFor.companyName)}</title>
  <style>
    :root {
      --brand-primary: ${safeCssColor(colors.primary)};
      --brand-secondary: ${safeCssColor(colors.secondary)};
      --brand-accent: ${safeCssColor(colors.accent)};
      --client-accent: ${safeCssColor(clientAccent)};
      --page-bg: ${safeCssColor(colors.background)};
      --surface: ${safeCssColor(colors.surface)};
      --text: ${safeCssColor(colors.text)};
      --muted: ${safeCssColor(colors.mutedText)};
      --border: ${safeCssColor(colors.border)};
    }

    @page {
      size: Letter;
      margin: 0.55in;
    }

    * { box-sizing: border-box; }

    html {
      color: var(--text);
      background: var(--page-bg);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--brand-accent) 16%, transparent), transparent 32rem),
        linear-gradient(180deg, var(--page-bg), #fff 70%);
    }

    .proposal {
      max-width: 980px;
      margin: 0 auto;
      padding: 32px;
    }

    .page {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 28px;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.08);
      margin: 0 0 24px;
      overflow: hidden;
      page-break-after: always;
    }

    .page:last-child { page-break-after: auto; }

    .cover {
      min-height: 900px;
      display: grid;
      grid-template-rows: auto 1fr auto;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.94), rgba(255,255,255,0.74)),
        linear-gradient(135deg, var(--brand-primary), var(--brand-accent));
    }

    .cover-top, .cover-bottom, .section { padding: 44px; }

    .brand-row, .prepared-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }

    .mark {
      display: inline-grid;
      place-items: center;
      width: 58px;
      height: 58px;
      border-radius: 18px;
      background: var(--brand-primary);
      color: white;
      font-weight: 800;
      letter-spacing: 0.08em;
    }

    .client-mark {
      display: inline-flex;
      align-items: center;
      border: 1px solid color-mix(in srgb, var(--client-accent) 40%, var(--border));
      border-radius: 999px;
      color: var(--client-accent);
      font-weight: 800;
      letter-spacing: 0.12em;
      padding: 8px 14px;
      text-transform: uppercase;
    }

    .eyebrow {
      color: var(--brand-accent);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.12em;
      margin: 0 0 12px;
      text-transform: uppercase;
    }

    h1, h2, h3, p { margin-top: 0; }

    h1 {
      color: var(--brand-primary);
      font-size: 58px;
      line-height: 0.96;
      letter-spacing: -0.05em;
      margin-bottom: 20px;
      max-width: 780px;
    }

    h2 {
      color: var(--brand-primary);
      font-size: 30px;
      letter-spacing: -0.03em;
      margin-bottom: 18px;
    }

    h3 {
      color: var(--brand-primary);
      font-size: 17px;
      margin-bottom: 8px;
    }

    .subtitle {
      color: var(--brand-secondary);
      font-size: 20px;
      max-width: 760px;
    }

    .recommendation {
      border-left: 5px solid var(--brand-accent);
      color: var(--brand-primary);
      font-size: 23px;
      font-weight: 700;
      line-height: 1.25;
      margin: 34px 0 0;
      padding: 18px 0 18px 22px;
    }

    .meta-grid, .metric-grid, .two-column, .three-column {
      display: grid;
      gap: 16px;
    }

    .meta-grid { grid-template-columns: repeat(3, 1fr); }
    .metric-grid { grid-template-columns: repeat(4, 1fr); }
    .two-column { grid-template-columns: repeat(2, 1fr); }
    .three-column { grid-template-columns: repeat(3, 1fr); }

    .card, .metric, .timeline-item, .scope-item {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 20px;
    }

    .metric {
      background: linear-gradient(180deg, #fff, color-mix(in srgb, var(--page-bg) 72%, #fff));
    }

    .metric-label, .small-label {
      color: var(--muted);
      display: block;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.12em;
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    .metric-value {
      color: var(--brand-primary);
      display: block;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }

    .muted { color: var(--muted); }

    ul.clean {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    ul.clean li {
      border-bottom: 1px solid var(--border);
      padding: 10px 0;
    }

    ul.clean li:last-child { border-bottom: 0; }

    .bullet-list {
      margin: 10px 0 0;
      padding-left: 18px;
    }

    .bullet-list li { margin: 6px 0; }

    .scope-item { margin-bottom: 16px; }

    .timeline {
      border-left: 3px solid var(--border);
      margin-left: 10px;
      padding-left: 22px;
    }

    .timeline-item {
      margin-bottom: 16px;
      position: relative;
    }

    .timeline-item::before {
      background: var(--brand-accent);
      border: 4px solid #fff;
      border-radius: 999px;
      content: "";
      height: 15px;
      left: -33px;
      position: absolute;
      top: 22px;
      width: 15px;
    }

    table {
      border-collapse: collapse;
      width: 100%;
    }

    th, td {
      border-bottom: 1px solid var(--border);
      padding: 13px 10px;
      text-align: left;
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .price {
      color: var(--brand-primary);
      font-weight: 800;
      white-space: nowrap;
    }

    .pill {
      background: color-mix(in srgb, var(--brand-accent) 12%, white);
      border: 1px solid color-mix(in srgb, var(--brand-accent) 24%, white);
      border-radius: 999px;
      color: var(--brand-primary);
      display: inline-block;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.06em;
      padding: 6px 10px;
      text-transform: uppercase;
    }

    .footer-note {
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 12px;
      margin-top: 28px;
      padding-top: 18px;
    }

    .warning {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 14px;
      color: #78350f;
      margin-bottom: 10px;
      padding: 12px 14px;
    }

    .appendix {
      background: #0f172a;
      color: #e5edf7;
    }

    .appendix h2, .appendix h3, .appendix .metric-value { color: #fff; }
    .appendix .muted, .appendix .metric-label, .appendix .small-label { color: #aab7c8; }
    .appendix .card, .appendix .metric { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.16); }
    .appendix th, .appendix td { border-color: rgba(255,255,255,0.16); }

    @media print {
      body { background: #fff; }
      .proposal { max-width: none; padding: 0; }
      .page { border: 0; border-radius: 0; box-shadow: none; margin: 0; min-height: calc(11in - 1.1in); }
      .cover { min-height: calc(11in - 1.1in); }
    }
  </style>
</head>
<body>
  <main class="proposal">
    <section class="page cover">
      <div class="cover-top brand-row">
        <div class="brand-row" style="justify-content: flex-start;">
          <div class="mark">${escapeHtml(viewModel.brand.logoText)}</div>
          <div>
            <strong>${escapeHtml(viewModel.brand.name)}</strong><br />
            <span class="muted">${escapeHtml(viewModel.brand.tagline ?? "Outcome-based build proposal")}</span>
          </div>
        </div>
        <span class="client-mark">${escapeHtml(viewModel.preparedFor.logoText ?? viewModel.preparedFor.companyName)}</span>
      </div>
      <div class="section">
        <p class="eyebrow">Proposal for ${escapeHtml(viewModel.preparedFor.companyName)}</p>
        <h1>${escapeHtml(viewModel.details.title)}</h1>
        ${optionalParagraph(viewModel.details.subtitle, "subtitle")}
        <p class="recommendation">${escapeHtml(viewModel.details.recommendation)}</p>
      </div>
      <div class="cover-bottom">
        <div class="meta-grid">
          ${metadataCard("Prepared for", preparedForLabel(viewModel))}
          ${metadataCard("Recommended offer", recommendedTierName)}
          ${metadataCard("Prepared", viewModel.generatedDate)}
        </div>
      </div>
    </section>

    <section class="page">
      <div class="section">
        <p class="eyebrow">Recommendation</p>
        <h2>Executive summary</h2>
        ${paragraphList(viewModel.details.executiveSummary)}
        <div class="metric-grid" style="margin-top: 26px;">
          ${metricCard("Recommended investment", viewModel.economics.formattedLeadPrice)}
          ${metricCard("Expected year-one value", viewModel.economics.yearOneValueRange)}
          ${metricCard("Conservative payback", viewModel.economics.paybackMonths)}
          ${metricCard("Value-based range", viewModel.economics.targetPriceRange)}
        </div>
        ${optionalParagraph(viewModel.details.investmentSummary, "card")}
      </div>
    </section>

    <section class="page">
      <div class="section">
        <p class="eyebrow">Discovery inputs</p>
        <h2>What we heard</h2>
        ${list(viewModel.details.whatWeHeard)}
        <div class="two-column" style="margin-top: 24px;">
          <div class="card">
            <span class="small-label">Client context</span>
            <p><strong>${escapeHtml(viewModel.preparedFor.companyName)}</strong>${buyerLine(viewModel)}</p>
            ${optionalWebsite(viewModel.preparedFor.website)}
          </div>
          <div class="card">
            <span class="small-label">Proposal posture</span>
            <p>This proposal focuses on client-visible investment, expected value, payback, delivery assumptions, and the decisions needed to start.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="page">
      <div class="section">
        <p class="eyebrow">Scope</p>
        <h2>Proposed scope and deliverables</h2>
        ${viewModel.scope.map(renderScopeItem).join("\n")}
      </div>
    </section>

    <section class="page">
      <div class="section">
        <p class="eyebrow">Delivery plan</p>
        <h2>Timeline and phases</h2>
        ${optionalParagraph(viewModel.details.timelineSummary, "subtitle")}
        <div class="timeline">
          ${viewModel.milestones.map(renderMilestone).join("\n")}
        </div>
      </div>
    </section>

    <section class="page">
      <div class="section">
        <p class="eyebrow">Economics</p>
        <h2>Investment and expected return</h2>
        <div class="two-column">
          <div class="card">
            <h3>Recommended investment</h3>
            <p><span class="metric-value">${escapeHtml(viewModel.economics.formattedLeadPrice)}</span></p>
            <p class="muted">Recommended tier: ${escapeHtml(recommendedTierName)}</p>
          </div>
          <div class="card">
            <h3>Return profile</h3>
            <p>Expected first-year value: <strong>${escapeHtml(viewModel.economics.yearOneValueRange)}</strong></p>
            <p>Conservative payback: <strong>${escapeHtml(viewModel.economics.paybackMonths)}</strong></p>
          </div>
        </div>
        <h3 style="margin-top: 28px;">Pricing tiers</h3>
        ${tierTable(viewModel.tiers)}
        <p class="footer-note">Future upside (${escapeHtml(viewModel.economics.futureUpsideRange)}) is shown for roadmap context only and is not included in payback.</p>
      </div>
    </section>

    <section class="page">
      <div class="section">
        <p class="eyebrow">Working agreement</p>
        <h2>Assumptions, exclusions, and client inputs</h2>
        <div class="three-column">
          ${contentColumn("Assumptions", viewModel.assumptions)}
          ${contentColumn("Exclusions", viewModel.exclusions)}
          ${contentColumn("Client inputs", viewModel.clientInputs)}
        </div>
      </div>
    </section>

    <section class="page">
      <div class="section">
        <p class="eyebrow">Activation</p>
        <h2>Next steps</h2>
        ${orderedList(viewModel.nextSteps)}
        <div class="card" style="margin-top: 28px;">
          <h3>${escapeHtml(viewModel.brand.name)}</h3>
          ${brandContact(viewModel)}
        </div>
      </div>
    </section>

    ${renderInternalAppendix(viewModel)}
  </main>
</body>
</html>`;
}

function renderScopeItem(item: ProposalScopeItem): string {
  return `<article class="scope-item">
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.description)}</p>
    <div class="two-column">
      <div>
        <span class="small-label">Deliverables</span>
        ${list(item.deliverables)}
      </div>
      <div>
        <span class="small-label">Outcomes</span>
        ${item.outcomes === undefined ? `<p class="muted">Confirmed during kickoff.</p>` : list(item.outcomes)}
      </div>
    </div>
  </article>`;
}

function renderMilestone(milestone: ProposalMilestone): string {
  return `<article class="timeline-item">
    <span class="pill">${escapeHtml(milestone.timing)}</span>
    <h3 style="margin-top: 12px;">${escapeHtml(milestone.name)}</h3>
    ${list(milestone.outcomes)}
  </article>`;
}

function renderInternalAppendix(viewModel: ProposalViewModel): string {
  const appendix = viewModel.internalAppendix;
  if (appendix === null) return "";

  return `<section class="page appendix">
    <div class="section">
      <p class="eyebrow">Internal only</p>
      <h2>Internal appendix: cost floor and guardrails</h2>
      <div class="metric-grid">
        ${metricCard("P50 cost floor", appendix.costFloorP50)}
        ${metricCard("P90 cost floor", appendix.costFloorP90)}
        ${metricCard("Risk-adjusted floor", appendix.riskAdjustedFloorP90)}
        ${metricCard("Target margin", appendix.margin)}
      </div>
      <div class="two-column" style="margin-top: 24px;">
        <div class="card">
          <h3>Cost inputs</h3>
          <p>Blended rate range: <strong>${escapeHtml(appendix.blendedRateRange)}</strong></p>
          <p>P50 hours: <strong>${escapeHtml(Math.round(appendix.analysis.cost.hours.p50).toLocaleString("en-US"))}</strong></p>
          <p>P90 hours: <strong>${escapeHtml(Math.round(appendix.analysis.cost.hours.p90).toLocaleString("en-US"))}</strong></p>
        </div>
        <div class="card">
          <h3>Guardrail warnings</h3>
          ${warningList(appendix.warnings)}
        </div>
      </div>
    </div>
  </section>`;
}

function warningList(warnings: readonly Warning[]): string {
  if (warnings.length === 0) return `<p class="muted">No guardrail warnings.</p>`;
  return warnings
    .map(
      (warning) =>
        `<div class="warning"><strong>${escapeHtml(warning.severity.toUpperCase())}: ${escapeHtml(
          warning.rule,
        )}</strong><br />${escapeHtml(warning.message)}</div>`,
    )
    .join("\n");
}

function tierTable(tiers: readonly Tier[]): string {
  return `<table>
    <thead><tr><th>Tier</th><th>Investment</th><th>Notes</th></tr></thead>
    <tbody>
      ${tiers
        .map(
          (tier) => `<tr>
            <td>${escapeHtml(tier.name)}</td>
            <td class="price">${tier.price === null ? "Scoped later" : escapeHtml(formatMoney(tier.price))}</td>
            <td>${escapeHtml(tier.note ?? "Included in current recommendation.")}</td>
          </tr>`,
        )
        .join("\n")}
    </tbody>
  </table>`;
}

function contentColumn(title: string, items: readonly string[]): string {
  return `<div class="card"><h3>${escapeHtml(title)}</h3>${list(items)}</div>`;
}

function list(items: readonly string[]): string {
  return `<ul class="clean">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}</ul>`;
}

function orderedList(items: readonly string[]): string {
  return `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}</ol>`;
}

function paragraphList(items: readonly string[]): string {
  return items.map((item) => `<p>${escapeHtml(item)}</p>`).join("\n");
}

function metricCard(label: string, value: string): string {
  return `<div class="metric"><span class="metric-label">${escapeHtml(label)}</span><span class="metric-value">${escapeHtml(
    value,
  )}</span></div>`;
}

function metadataCard(label: string, value: string): string {
  return `<div class="card"><span class="small-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function optionalParagraph(value: string | undefined, className: string): string {
  if (value === undefined) return "";
  return `<p class="${escapeAttribute(className)}">${escapeHtml(value)}</p>`;
}

function optionalWebsite(value: string | undefined): string {
  if (value === undefined) return "";
  return `<p class="muted">Website: ${escapeHtml(value)}</p>`;
}

function preparedForLabel(viewModel: ProposalViewModel): string {
  const buyer = viewModel.preparedFor.buyerName;
  if (buyer === undefined) return viewModel.preparedFor.companyName;
  return `${buyer}, ${viewModel.preparedFor.companyName}`;
}

function buyerLine(viewModel: ProposalViewModel): string {
  const { buyerName, buyerTitle } = viewModel.preparedFor;
  if (buyerName === undefined && buyerTitle === undefined) return "";
  if (buyerName !== undefined && buyerTitle !== undefined)
    return ` — ${escapeHtml(buyerName)}, ${escapeHtml(buyerTitle)}`;
  return ` — ${escapeHtml(buyerName ?? buyerTitle ?? "")}`;
}

function brandContact(viewModel: ProposalViewModel): string {
  const contact = [viewModel.brand.email, viewModel.brand.phone, viewModel.brand.website].filter(
    isString,
  );
  if (contact.length === 0)
    return `<p class="muted">Contact details can be added in the brand profile.</p>`;
  return `<p class="muted">${contact.map(escapeHtml).join(" • ")}</p>`;
}

function isString(input: string | undefined): input is string {
  return input !== undefined;
}

function safeCssColor(input: string): string {
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]+$/.test(trimmed)) return trimmed;
  if (/^(rgb|rgba|hsl|hsla)\([0-9%.,\s-]+\)$/.test(trimmed)) return trimmed;
  return "#111827";
}
