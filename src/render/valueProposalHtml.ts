import type { Range } from "../core/types.js";
import { formatMoney, formatProposalDate } from "../proposal/format.js";
import type {
  ProposalActualDeliverable,
  ProposalAudience,
  ProposalBrand,
  ProposalBuildPlanStep,
  ProposalDraft,
  ProposalFooter,
  ProposalPhaseDiscount,
  ProposalPricingPhase,
  ProposalTerms,
  ProposalValueSourceRow,
} from "../proposal/types.js";

export interface RenderValueProposalHtmlOptions {
  readonly brand: ProposalBrand;
  readonly audience?: ProposalAudience;
  readonly generatedAt?: Date;
}

interface CoverMetric {
  readonly value: string;
  readonly label: string;
}

export function renderValueProposalHtml(
  draft: ProposalDraft,
  options: RenderValueProposalHtmlOptions,
): string {
  const audience = options.audience ?? "client";
  const brand = options.brand;
  const colors = brand.colors;
  const clientAccent = draft.preparedFor.accentColor ?? colors.accent;
  const preparedDate = draft.details.date ?? formatGeneratedDate(options.generatedAt);
  const leadPhase = firstPricedPhase(draft.pricing.phases);
  const coverMetrics = buildCoverMetrics(draft, leadPhase);

  return `<!doctype html>
<html lang="en" data-audience="${escapeAttribute(audience)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(draft.details.title)} — ${escapeHtml(draft.preparedFor.companyName)}</title>
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
      --ink: #243041;
      --deep: #083d5a;
      --deep-2: #0c5a7d;
      --ice: #eaf6fd;
    }

    @page {
      size: Letter;
      margin: 0;
    }

    * { box-sizing: border-box; }

    html {
      color: var(--ink);
      background: #f6f8fb;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.42;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body { margin: 0; }

    .proposal {
      margin: 0 auto;
      max-width: 816px;
    }

    .page {
      background: var(--surface);
      min-height: 1056px;
      padding: 70px 68px 54px;
      page-break-after: always;
      position: relative;
    }

    .page:last-child { page-break-after: auto; }

    .cover {
      background:
        radial-gradient(circle at 96% 6%, rgba(125, 211, 252, 0.16), transparent 28rem),
        linear-gradient(158deg, #052f45 0%, #063e5c 54%, #0b6388 100%);
      color: #f8fcff;
      display: grid;
      grid-template-rows: auto 1fr auto;
      overflow: hidden;
    }

    .cover::after {
      border: 1px solid rgba(191, 229, 248, 0.12);
      border-radius: 999px;
      content: "";
      height: 560px;
      position: absolute;
      right: -310px;
      top: -180px;
      width: 560px;
    }

    .internal-banner {
      background: #7f1d1d;
      color: #fff;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.14em;
      padding: 8px 68px;
      position: absolute;
      right: 0;
      text-transform: uppercase;
      top: 0;
      z-index: 2;
    }

    .brand-lockup {
      align-items: center;
      display: inline-flex;
      gap: 12px;
    }

    .brand-mark {
      align-items: center;
      border: 1px solid rgba(204, 235, 250, 0.84);
      color: currentColor;
      display: inline-flex;
      font-size: 16px;
      font-weight: 900;
      justify-content: center;
      letter-spacing: -0.04em;
      min-height: 46px;
      min-width: 86px;
      padding: 6px 10px;
    }

    .brand-name {
      font-size: 13px;
      font-weight: 800;
      line-height: 1.05;
      max-width: 150px;
    }

    .cover-main {
      align-self: center;
      margin-top: 42px;
      max-width: 650px;
      position: relative;
      z-index: 1;
    }

    .eyebrow,
    .section-number,
    .small-label {
      color: var(--deep);
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }

    .cover .eyebrow,
    .cover .small-label {
      color: #d7f0fb;
    }

    h1,
    h2,
    h3,
    p { margin-top: 0; }

    h1 {
      color: #fff;
      font-size: 45px;
      letter-spacing: -0.055em;
      line-height: 1.03;
      margin: 58px 0 28px;
      max-width: 620px;
    }

    h1 .accent { color: #c8eafe; }

    h2 {
      color: #222c3a;
      font-size: 28px;
      letter-spacing: -0.035em;
      line-height: 1.25;
      margin: 12px 0 12px;
    }

    h3 {
      color: #243041;
      font-size: 17px;
      line-height: 1.25;
      margin-bottom: 10px;
    }

    .lead {
      color: #44546a;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 18px;
    }

    .cover .lead {
      color: #d1e6f3;
      font-size: 18px;
      max-width: 640px;
    }

    .rule {
      background: #c5eafc;
      border-radius: 999px;
      height: 4px;
      margin: 34px 0 28px;
      width: 82px;
    }

    .pill {
      border: 1px solid currentColor;
      border-radius: 999px;
      display: inline-flex;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.14em;
      padding: 9px 16px;
      text-transform: uppercase;
    }

    .cover .pill {
      color: #d9effb;
    }

    .metric-strip {
      border: 1px solid rgba(211, 238, 250, 0.22);
      border-radius: 18px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      margin-top: 46px;
      overflow: hidden;
    }

    .cover-metric {
      background: rgba(255, 255, 255, 0.055);
      border-right: 1px solid rgba(211, 238, 250, 0.16);
      padding: 24px 22px;
    }

    .cover-metric:last-child { border-right: 0; }

    .metric-value {
      color: #fff;
      display: block;
      font-size: 35px;
      font-weight: 900;
      letter-spacing: -0.055em;
      line-height: 1;
      margin-bottom: 14px;
    }

    .metric-label {
      color: #d1e6f3;
      display: block;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.16em;
      line-height: 1.35;
      text-transform: uppercase;
    }

    .cover-footer {
      border-top: 1px solid rgba(211, 238, 250, 0.18);
      display: grid;
      gap: 38px;
      grid-template-columns: 2fr 1.4fr 1fr;
      padding-top: 26px;
      position: relative;
      z-index: 1;
    }

    .cover-footer .value {
      color: #fff;
      font-size: 15px;
      font-weight: 800;
      margin-top: 7px;
    }

    .content-header { margin-bottom: 26px; }

    .muted { color: #8390a3; }
    .strong-muted { color: #405169; font-weight: 800; }

    .unlock-grid {
      display: grid;
      gap: 8px 36px;
      grid-template-columns: repeat(2, 1fr);
      margin: 22px 0 28px;
    }

    .unlock {
      align-items: flex-start;
      color: #41506a;
      display: grid;
      font-size: 13px;
      gap: 10px;
      grid-template-columns: 18px 1fr;
      line-height: 1.45;
      min-height: 38px;
    }

    .unlock-icon {
      color: var(--deep-2);
      font-size: 15px;
      font-weight: 900;
      line-height: 1.2;
    }

    table {
      border-collapse: collapse;
      width: 100%;
    }

    th,
    td {
      border-bottom: 1px solid #dbe4ee;
      padding: 14px 14px;
      text-align: left;
      vertical-align: top;
    }

    th {
      color: #8a98aa;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.15em;
      text-transform: uppercase;
    }

    .value-table td:first-child,
    .value-table th:first-child { padding-left: 0; }
    .value-table td:last-child,
    .value-table th:last-child { padding-right: 0; text-align: right; }

    .row-title {
      color: #243041;
      display: block;
      font-size: 16px;
      font-weight: 900;
      margin-bottom: 4px;
    }

    .row-detail {
      color: #7f8fa3;
      display: block;
      font-size: 12px;
      line-height: 1.55;
    }

    .money {
      color: var(--deep);
      font-size: 18px;
      font-weight: 900;
      letter-spacing: -0.035em;
      white-space: nowrap;
    }

    .total-row td {
      border-bottom: 0;
      border-top: 2px solid var(--deep);
      padding-top: 18px;
    }

    .total-row .row-title,
    .total-row .money { font-size: 20px; }

    .note {
      color: #8795a8;
      font-size: 11px;
      font-style: italic;
      line-height: 1.55;
      margin: 16px 0 0;
    }

    .savings-box {
      background: #eef8fe;
      border: 1px dashed var(--deep-2);
      border-radius: 16px;
      margin-top: 16px;
      padding: 14px 16px;
    }

    .savings-box h3 {
      color: var(--deep);
      font-size: 13px;
      letter-spacing: 0.13em;
      margin-bottom: 8px;
      text-transform: uppercase;
    }

    .savings-row {
      align-items: baseline;
      border-top: 1px dashed #c8ddeb;
      display: grid;
      font-size: 12px;
      gap: 12px;
      grid-template-columns: 1fr auto;
      padding: 7px 0;
    }

    .savings-row:first-of-type { border-top: 0; }
    .savings-row strong { color: #243041; }
    .savings-row .money { font-size: 13px; }

    .diagram-shell {
      border: 1px solid #dbe4ee;
      border-radius: 18px;
      margin-top: 22px;
      padding: 16px;
    }

    .build-diagram {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, 1fr);
    }

    .build-step {
      border: 1px solid #dbe4ee;
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      min-height: 186px;
      padding: 16px 14px;
    }

    .build-step:nth-child(2) {
      background: linear-gradient(160deg, var(--deep), var(--deep-2));
      border-color: var(--deep);
      color: #eaf7ff;
    }

    .build-step:nth-child(2) h3,
    .build-step:nth-child(2) .step-number,
    .build-step:nth-child(2) .step-timing { color: #fff; }
    .build-step:nth-child(2) .mini-pill { background: #cfecfb; color: var(--deep); }

    .step-number {
      color: var(--deep);
      font-size: 14px;
      font-weight: 900;
      margin-bottom: 6px;
    }

    .step-timing {
      color: #8190a3;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.12em;
      margin-bottom: 9px;
      text-transform: uppercase;
    }

    .build-step h3 { color: var(--deep); font-size: 15px; }
    .build-step p { font-size: 12px; line-height: 1.45; margin-bottom: 12px; }

    .mini-pill-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: auto;
    }

    .mini-pill {
      background: #e8f6fc;
      border-radius: 999px;
      color: var(--deep-2);
      font-size: 10px;
      font-weight: 900;
      padding: 5px 8px;
    }

    .principle-grid,
    .deliverable-grid,
    .phase-grid,
    .terms-grid {
      display: grid;
      gap: 16px;
    }

    .principle-grid { grid-template-columns: repeat(2, 1fr); margin-top: 18px; }
    .deliverable-grid { grid-template-columns: repeat(2, 1fr); margin-top: 22px; }
    .phase-grid { grid-template-columns: repeat(3, 1fr); margin-top: 18px; }
    .terms-grid { grid-template-columns: repeat(3, 1fr); margin-top: 18px; }

    .card {
      border: 1px solid #dbe4ee;
      border-radius: 16px;
      padding: 18px;
    }

    .principle-card { min-height: 118px; }

    .deliverable-card {
      min-height: 190px;
      padding: 22px;
    }

    .icon-box {
      align-items: center;
      background: var(--deep);
      border-radius: 12px;
      color: #fff;
      display: inline-flex;
      font-size: 20px;
      font-weight: 900;
      height: 42px;
      justify-content: center;
      margin-bottom: 16px;
      width: 42px;
    }

    ul.clean {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    ul.clean li {
      border-bottom: 1px solid #e2e8f0;
      color: #42516a;
      font-size: 12px;
      line-height: 1.45;
      padding: 6px 0 6px 20px;
      position: relative;
    }

    ul.clean li::before {
      color: var(--deep-2);
      content: "✓";
      font-weight: 900;
      left: 0;
      position: absolute;
    }

    ul.clean li:last-child { border-bottom: 0; }

    .deliverable-card ul.clean { margin-top: 10px; }

    .quote-list {
      border-left: 2px solid #bfdbfe;
      color: var(--deep-2);
      font-size: 12px;
      font-style: italic;
      margin-top: 10px;
      padding-left: 12px;
    }

    .phase-card {
      border: 1px solid #dbe4ee;
      border-radius: 18px;
      overflow: hidden;
      position: relative;
    }

    .phase-card.start {
      border: 2px solid var(--deep);
    }

    .phase-header {
      padding: 18px 18px 12px;
    }

    .phase-card.start .phase-header {
      background: linear-gradient(160deg, var(--deep), var(--deep-2));
      color: #fff;
    }

    .phase-card.start .phase-header h3,
    .phase-card.start .phase-header .phase-price,
    .phase-card.start .phase-header .phase-label,
    .phase-card.start .phase-header .phase-note { color: #fff; }

    .phase-label {
      color: #8a98aa;
      display: block;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.18em;
      margin-bottom: 8px;
      text-transform: uppercase;
    }

    .start-here {
      background: #d6eefb;
      border-radius: 999px;
      color: #123a4f;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.13em;
      padding: 8px 16px;
      position: absolute;
      right: 0;
      text-transform: uppercase;
      top: 18px;
    }

    .phase-price {
      color: var(--deep);
      font-size: 30px;
      font-weight: 900;
      letter-spacing: -0.055em;
      line-height: 1.1;
      margin-top: 12px;
    }

    .phase-note {
      color: #8190a3;
      font-size: 12px;
      font-weight: 800;
      margin-top: 6px;
    }

    .phase-body { padding: 14px 18px 20px; }

    .discount {
      color: inherit;
      font-size: 12px;
      font-weight: 800;
      margin: 6px 0;
    }

    .discount s { opacity: 0.78; }

    .payback-banner {
      align-items: center;
      background: linear-gradient(135deg, #032f45, #073e59);
      border-radius: 16px;
      color: #eaf7ff;
      display: grid;
      gap: 28px;
      grid-template-columns: 170px 1fr;
      margin-top: 16px;
      padding: 18px 24px;
    }

    .payback-banner .big {
      color: #cdeefe;
      font-size: 43px;
      font-weight: 900;
      letter-spacing: -0.06em;
    }

    .payback-banner h3 { color: #fff; margin-bottom: 6px; }
    .payback-banner p { color: #dceffc; margin: 0; }

    .next-step {
      align-items: flex-start;
      border-bottom: 1px solid #dbe4ee;
      display: grid;
      gap: 14px;
      grid-template-columns: 34px 1fr;
      padding: 10px 0;
    }

    .next-step-number {
      align-items: center;
      background: var(--deep);
      border-radius: 999px;
      color: #fff;
      display: inline-flex;
      font-size: 14px;
      font-weight: 900;
      height: 30px;
      justify-content: center;
      width: 30px;
    }

    .next-step h3 { font-size: 15px; margin: 0 0 3px; }
    .next-step p { color: #465872; font-size: 12px; margin: 0; }

    .terms-line {
      color: #7f8fa3;
      font-size: 10px;
      font-style: italic;
      line-height: 1.45;
      margin: 12px 0 10px;
    }

    .page-footer {
      align-items: center;
      border-top: 1px solid #dbe4ee;
      bottom: 28px;
      color: #8a98aa;
      display: grid;
      font-size: 11px;
      grid-template-columns: 1fr auto;
      left: 68px;
      position: absolute;
      right: 68px;
      padding-top: 10px;
    }

    .footer-brand {
      align-items: center;
      display: inline-flex;
      gap: 8px;
    }

    .footer-mark {
      align-items: center;
      border: 1px solid #8eb7cf;
      color: var(--deep);
      display: inline-flex;
      font-size: 8px;
      font-weight: 900;
      justify-content: center;
      min-height: 16px;
      min-width: 26px;
      padding: 2px 4px;
    }

    @media screen {
      body { padding: 24px 0; }
      .page { box-shadow: 0 18px 70px rgba(15, 23, 42, 0.12); margin-bottom: 24px; }
    }

    @media print {
      body { background: #fff; padding: 0; }
      .proposal { max-width: none; }
      .page { height: 11in; min-height: 11in; width: 8.5in; }
    }
  </style>
</head>
<body>
  <main class="proposal">
    <section class="page cover" data-page="cover" aria-label="Value proposal cover">
      ${audience === "internal" ? renderInternalBanner() : ""}
      <div class="brand-lockup">
        <div class="brand-mark">${escapeHtml(brand.logoText)}</div>
        <div class="brand-name">${escapeHtml(brand.name)}</div>
      </div>
      <div class="cover-main">
        <p class="eyebrow">Prepared for ${escapeHtml(draft.preparedFor.companyName)}</p>
        <h1>${formatCoverHeadline(draft.valueProposal.headline)}</h1>
        <div class="rule"></div>
        ${optionalParagraph(draft.valueProposal.narrative, "lead")}
        <p class="lead">${escapeHtml(draft.details.recommendation)}</p>
        <span class="pill">Cost savings · Build plan · Pricing</span>
        <div class="metric-strip">
          ${coverMetrics.map(renderCoverMetric).join("\n")}
        </div>
      </div>
      <div class="cover-footer">
        ${coverFooterItem("Presented to", preparedForLabel(draft))}
        ${coverFooterItem("Engagement", leadPhase?.name ?? draft.details.title)}
        ${coverFooterItem("Date", preparedDate)}
      </div>
    </section>

    <section class="page" data-page="value-unlocks" aria-label="Value unlocks and recovered-value table">
      <header class="content-header">
        <p class="section-number">01 What this unlocks for ${escapeHtml(clientShortName(draft))}</p>
        <h2>${escapeHtml(draft.valueProposal.headline)}</h2>
        ${optionalParagraph(draft.valueProposal.narrative, "lead")}
      </header>
      <div class="unlock-grid">
        ${draft.valueProposal.unlocks.map(renderUnlock).join("\n")}
      </div>
      ${renderValueSourceTable(draft.valueProposal.valueSources, draft.valueProposal.annualValueTarget)}
      <p class="note">These are conservative client-facing numbers. They do not assume headcount cuts; they show the value of cleaner access, faster answers, and fewer manual handoffs.</p>
      ${renderSavingsBox(draft.valueProposal.valueSources, draft.valueProposal.sixMonthSavings)}
      ${renderPageFooter(brand, draft.footer, draft.preparedFor.companyName, 2)}
    </section>

    <section class="page" data-page="build-plan" aria-label="Build plan diagram">
      <header class="content-header">
        <p class="section-number">02 What we build</p>
        <h2>${escapeHtml(buildPlanHeading(draft))}</h2>
        <p class="lead">${escapeHtml(draft.details.timelineSummary ?? "A practical sequence that connects the systems already in place, proves the data, and hands over a trusted operating layer.")}</p>
      </header>
      <div class="diagram-shell">
        <div class="build-diagram">
          ${draft.buildPlan.map(renderBuildPlanStep).join("\n")}
        </div>
      </div>
      <div style="margin-top: 18px;">
        <p class="section-number">03 How we keep it practical</p>
      </div>
      <div class="principle-grid">
        ${renderPrincipleCard("Clean numbers first", firstOrFallback(draft.terms.assumptions, "The system is only useful if the data is right, so source validation and reconciliation come before broad rollout."))}
        ${renderPrincipleCard("People still make the call", firstOrFallback(draft.terms.clientResponsibilities, "The software speeds up the work while the client team keeps judgment, review, and final decisions."))}
      </div>
      ${renderPageFooter(brand, draft.footer, draft.preparedFor.companyName, 3)}
    </section>

    <section class="page" data-page="actual-deliverables" aria-label="Actual deliverables">
      <header class="content-header">
        <p class="section-number">04 What you'll actually have</p>
        <h2>One clean place to answer questions, build reports, and cut the manual back-and-forth.</h2>
        <p class="lead">${escapeHtml(draft.details.subtitle ?? "Here is what the client has at the end of the pilot.")}</p>
      </header>
      <div class="deliverable-grid">
        ${draft.actualDeliverables.map(renderActualDeliverable).join("\n")}
      </div>
      <p class="strong-muted" style="margin-top: 14px;">How we build it: purpose-built software and documented handoff artifacts that stay flexible as tools, models, data sources, and workflows change.</p>
      ${renderPageFooter(brand, draft.footer, draft.preparedFor.companyName, 4)}
    </section>

    <section class="page" data-page="investment-next-steps" aria-label="Investment phases, next steps, terms, and footer">
      <header class="content-header">
        <p class="section-number">05 Your investment</p>
        <h2>${escapeHtml(investmentHeading(draft))}</h2>
        <p class="lead">${escapeHtml(draft.pricing.summary)}</p>
      </header>
      <div class="phase-grid">
        ${draft.pricing.phases.map((phase, index) => renderPricingPhase(phase, index, draft, leadPhase)).join("\n")}
      </div>
      ${renderWhyOpen(draft.terms.changeControl)}
      ${renderPaybackBanner(leadPhase, draft.valueProposal.sixMonthSavings)}
      <div style="margin-top: 14px;">
        <p class="section-number">06 Next steps</p>
        ${draft.nextSteps.map(renderNextStep).join("\n")}
      </div>
      ${renderTermsLine(draft.terms, draft.footer)}
      ${renderPageFooter(brand, draft.footer, draft.preparedFor.companyName, 5)}
    </section>
  </main>
</body>
</html>`;
}

function renderInternalBanner(): string {
  return `<div class="internal-banner">Internal review copy · do not send until approved</div>`;
}

function buildCoverMetrics(
  draft: ProposalDraft,
  leadPhase: ProposalPricingPhase | null,
): readonly CoverMetric[] {
  return [
    {
      value: formatCompactMoneyRange(draft.valueProposal.sixMonthSavings),
      label: "Expected value in first 6 months",
    },
    {
      value: formatPaybackMonths(leadPhase?.price ?? null, draft.valueProposal.sixMonthSavings),
      label: "Payback on the pilot build",
    },
    {
      value: deliverableSystemLabel(),
      label: "One place for trusted answers",
    },
  ];
}

function renderCoverMetric(metric: CoverMetric): string {
  return `<div class="cover-metric"><span class="metric-value">${escapeHtml(metric.value)}</span><span class="metric-label">${escapeHtml(metric.label)}</span></div>`;
}

function coverFooterItem(label: string, value: string): string {
  return `<div><span class="small-label">${escapeHtml(label)}</span><div class="value">${escapeHtml(value)}</div></div>`;
}

function renderUnlock(unlock: string): string {
  return `<div class="unlock"><span class="unlock-icon">↻</span><span>${emphasizePrefix(unlock)}</span></div>`;
}

function emphasizePrefix(value: string): string {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator > 44) return escapeHtml(value);
  const prefix = value.slice(0, separator);
  const rest = value.slice(separator + 1).trimStart();
  return `<strong>${escapeHtml(prefix)}:</strong> ${escapeHtml(rest)}`;
}

function renderValueSourceTable(
  rows: readonly ProposalValueSourceRow[],
  annualValueTarget: number,
): string {
  const annualRange = sumRanges(rows.map((row) => row.annualValue));

  return `<table class="value-table">
    <thead>
      <tr>
        <th>Where recovered value comes from</th>
        <th>Business impact</th>
        <th>Annual value target</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(renderValueSourceRow).join("\n")}
      <tr class="total-row">
        <td colspan="2"><span class="row-title">Conservative annual value target</span><span class="row-detail">Modeled source range: ${escapeHtml(formatApproxCompactMoneyRange(annualRange))}</span></td>
        <td><span class="money">${escapeHtml(formatApproxCompactMoney(annualValueTarget))}</span></td>
      </tr>
    </tbody>
  </table>`;
}

function renderValueSourceRow(row: ProposalValueSourceRow): string {
  return `<tr>
    <td><span class="row-title">${escapeHtml(row.label)}</span><span class="row-detail">${escapeHtml(row.source)}</span></td>
    <td><span class="row-detail"><strong>Current:</strong> ${escapeHtml(row.currentState)}</span><span class="row-detail"><strong>Future:</strong> ${escapeHtml(row.futureState)}</span>${optionalConfidence(row.confidence)}</td>
    <td><span class="money">${escapeHtml(formatCompactMoneyRange(row.annualValue))}</span></td>
  </tr>`;
}

function optionalConfidence(confidence: ProposalValueSourceRow["confidence"]): string {
  if (confidence === undefined) return "";
  return `<span class="row-detail"><strong>Confidence:</strong> ${escapeHtml(confidence)}</span>`;
}

function renderSavingsBox(rows: readonly ProposalValueSourceRow[], sixMonthSavings: Range): string {
  const sourceRows = rows.slice(0, 2).map((row) => ({
    label: row.label,
    value: halveRange(row.annualValue),
  }));

  return `<section class="savings-box" aria-label="How the pilot earns its money back">
    <h3>How the pilot earns its money back</h3>
    <p style="font-size: 12px; margin-bottom: 8px;">In the first six months, the team gets capacity back across reporting prep, data pulls, repeated checks, and follow-up loops.</p>
    ${sourceRows
      .map(
        (row) =>
          `<div class="savings-row"><span><strong>${escapeHtml(row.label)}</strong></span><span class="money">${escapeHtml(formatCompactMoneyRange(row.value))}</span></div>`,
      )
      .join("\n")}
    <div class="savings-row"><span><strong>Target savings in the first six months</strong></span><span class="money">${escapeHtml(formatApproxCompactMoneyRange(sixMonthSavings))}</span></div>
  </section>`;
}

function renderBuildPlanStep(step: ProposalBuildPlanStep, index: number): string {
  const activities = step.activities.slice(0, 3);
  const outcomes = step.outcomes.slice(0, 2);
  return `<article class="build-step">
    <span class="step-number">${escapeHtml(String(index + 1))}. ${escapeHtml(step.name)}</span>
    <span class="step-timing">${escapeHtml(step.timing)}</span>
    <p>${escapeHtml(step.description)}</p>
    <div class="mini-pill-list">
      ${[...activities, ...outcomes].map((item) => `<span class="mini-pill">${escapeHtml(item)}</span>`).join("\n")}
    </div>
  </article>`;
}

function renderPrincipleCard(title: string, body: string): string {
  return `<article class="card principle-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`;
}

function renderActualDeliverable(deliverable: ProposalActualDeliverable, index: number): string {
  return `<article class="card deliverable-card">
    <div class="icon-box">${escapeHtml(deliverableIcon(index))}</div>
    <h3>${escapeHtml(deliverable.title)}</h3>
    <p>${escapeHtml(deliverable.description)}</p>
    ${list(deliverable.included)}
    ${renderAcceptanceCriteria(deliverable.acceptanceCriteria)}
  </article>`;
}

function renderAcceptanceCriteria(criteria: readonly string[] | undefined): string {
  if (criteria === undefined || criteria.length === 0) return "";
  return `<div class="quote-list">${criteria.map((item) => `<div>${escapeHtml(item)}</div>`).join("\n")}</div>`;
}

function renderPricingPhase(
  phase: ProposalPricingPhase,
  index: number,
  draft: ProposalDraft,
  leadPhase: ProposalPricingPhase | null,
): string {
  const isStart = phase === leadPhase;
  const inclusions = phaseInclusions(phase, index, draft, isStart);
  return `<article class="phase-card${isStart ? " start" : ""}">
    ${isStart ? `<span class="start-here">Start here</span>` : ""}
    <div class="phase-header">
      <span class="phase-label">Phase ${escapeHtml(String(index + 1))}${index === 1 ? " · Build on it" : index >= 2 ? " · AI-first operations" : ""}</span>
      <h3>${escapeHtml(phase.name)}</h3>
      ${renderDiscounts(phase.discounts, phase.price)}
      <div class="phase-price">${escapeHtml(formatPhasePrice(phase.price))}</div>
      <p class="phase-note">${escapeHtml(phase.price === null ? (phase.note ?? "Scoped when ready") : "net investment")}</p>
    </div>
    <div class="phase-body">
      ${inclusions.length === 0 ? optionalParagraph(phase.note, "muted") : list(inclusions)}
    </div>
  </article>`;
}

function renderDiscounts(
  discounts: readonly ProposalPhaseDiscount[] | undefined,
  price: number | null,
): string {
  if (discounts === undefined || discounts.length === 0 || price === null) return "";
  const discountTotal = discounts.reduce((total, discount) => total + discount.amount, 0);
  const standardPrice = price + discountTotal;
  return `<p class="discount">Standard: <s>${escapeHtml(formatCompactMoney(standardPrice))}</s></p>
    ${discounts
      .map(
        (discount) =>
          `<p class="discount">${escapeHtml(discount.label)}: ~−${escapeHtml(formatCompactMoney(discount.amount))}${discount.reason === undefined ? "" : `<br /><span>${escapeHtml(discount.reason)}</span>`}</p>`,
      )
      .join("\n")}`;
}

function phaseInclusions(
  phase: ProposalPricingPhase,
  index: number,
  draft: ProposalDraft,
  isStart: boolean,
): readonly string[] {
  if (isStart) {
    return draft.actualDeliverables.map((deliverable) => deliverable.title).slice(0, 6);
  }
  if (phase.note !== undefined) return [phase.note];
  if (index === 1) return draft.buildPlan.map((step) => step.name).slice(0, 5);
  return draft.valueProposal.unlocks.slice(0, 5);
}

function renderWhyOpen(changeControl: string | undefined): string {
  if (changeControl === undefined) return "";
  return `<section class="savings-box" style="background:#f8fafc;" aria-label="Why later phases stay open">
    <h3>Why later phases stay open</h3>
    <p style="font-size: 12px; margin: 0;">${escapeHtml(changeControl)}</p>
  </section>`;
}

function renderPaybackBanner(
  leadPhase: ProposalPricingPhase | null,
  sixMonthSavings: Range,
): string {
  return `<section class="payback-banner" aria-label="Payback on the pilot">
    <div class="big">${escapeHtml(formatPaybackMonths(leadPhase?.price ?? null, sixMonthSavings))}</div>
    <div>
      <h3>Payback on the pilot</h3>
      <p>${escapeHtml(paybackNarrative(leadPhase?.price ?? null, sixMonthSavings))}</p>
    </div>
  </section>`;
}

function renderNextStep(step: string, index: number): string {
  const separator = step.indexOf(":");
  const title = separator > 0 && separator < 80 ? step.slice(0, separator) : step;
  const detail =
    separator > 0 && separator < 80
      ? step.slice(separator + 1).trimStart()
      : "Confirm on the next working session.";
  return `<article class="next-step"><span class="next-step-number">${escapeHtml(String(index + 1))}</span><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p></div></article>`;
}

function renderTermsLine(terms: ProposalTerms, footer: ProposalFooter): string {
  const termsText = [
    terms.paymentTerms,
    terms.expiration,
    footer.legal,
    terms.exclusions.length === 0 ? undefined : `Exclusions: ${terms.exclusions.join("; ")}`,
  ].filter(isString);
  return `<p class="terms-line">Terms: ${escapeHtml(termsText.join("; "))}</p>`;
}

function renderPageFooter(
  brand: ProposalBrand,
  footer: ProposalFooter,
  clientName: string,
  pageNumber: number,
): string {
  const contact = [brand.website, footer.contact].filter(isString).join(" · ");
  const brandDetails = contact.length === 0 ? brand.name : `${brand.name} · ${contact}`;
  return `<footer class="page-footer">
    <div class="footer-brand"><span class="footer-mark">${escapeHtml(brand.logoText)}</span><span>${escapeHtml(brandDetails)} for ${escapeHtml(clientName)}</span></div>
    <span>${escapeHtml(footer.confidentiality)} · Page ${escapeHtml(String(pageNumber))}</span>
  </footer>`;
}

function list(items: readonly string[]): string {
  if (items.length === 0) return `<p class="muted">Confirmed during kickoff.</p>`;
  return `<ul class="clean">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}</ul>`;
}

function optionalParagraph(value: string | undefined, className: string): string {
  if (value === undefined) return "";
  return `<p class="${escapeAttribute(className)}">${escapeHtml(value)}</p>`;
}

function preparedForLabel(draft: ProposalDraft): string {
  const buyerName = draft.preparedFor.buyerName;
  if (buyerName === undefined) return draft.preparedFor.companyName;
  return `${buyerName} and the ${clientTitleName(draft)} Team`;
}

function clientShortName(draft: ProposalDraft): string {
  const logoText = draft.preparedFor.logoText;
  if (logoText !== undefined) return logoText;
  return clientTitleName(draft);
}

function clientTitleName(draft: ProposalDraft): string {
  const [firstWord] = draft.preparedFor.companyName.split(" ");
  return firstWord ?? draft.preparedFor.companyName;
}

function buildPlanHeading(draft: ProposalDraft): string {
  return `${clientTitleName(draft)}'s own system is built on real operating data.`;
}

function investmentHeading(draft: ProposalDraft): string {
  const leadPhase = firstPricedPhase(draft.pricing.phases);
  if (leadPhase === null)
    return "We start with the work that stops the weekly leak, then build on it.";
  return `We start with ${leadPhase.name}, then build on it.`;
}

function firstOrFallback(items: readonly string[], fallback: string): string {
  return items[0] ?? fallback;
}

function firstPricedPhase(phases: readonly ProposalPricingPhase[]): ProposalPricingPhase | null {
  for (const phase of phases) {
    if (phase.price !== null) return phase;
  }
  return null;
}

function formatCoverHeadline(headline: string): string {
  const escaped = escapeHtml(headline);
  const marker = "About ";
  const markerIndex = escaped.indexOf(marker);
  if (markerIndex < 0) return escaped;
  return `${escaped.slice(0, markerIndex)}<span class="accent">${escaped.slice(markerIndex)}</span>`;
}

function deliverableSystemLabel(): string {
  return "1 system";
}

function formatPhasePrice(price: number | null): string {
  if (price === null) return "Scoped when ready";
  return formatCompactMoney(price);
}

function formatPaybackMonths(price: number | null, sixMonthSavings: Range): string {
  if (price === null || sixMonthSavings.low <= 0) return "TBD";
  const monthlySavings = sixMonthSavings.low / 6;
  if (monthlySavings <= 0) return "TBD";
  const months = price / monthlySavings;
  if (months < 1) return "<1 mo";
  return `~${Math.max(1, Math.round(months)).toLocaleString("en-US")} mo`;
}

function paybackNarrative(price: number | null, sixMonthSavings: Range): string {
  if (price === null) {
    return `The pilot is scoped against a six-month path to roughly ${formatCompactMoneyRange(sixMonthSavings)} in recovered time and avoided busywork.`;
  }
  return `The ${formatMoney(price)} pilot sits against a six-month path to roughly ${formatCompactMoneyRange(sixMonthSavings)} in recovered time and avoided busywork, paying for itself early without assuming headcount cuts.`;
}

function formatGeneratedDate(generatedAt: Date | undefined): string {
  if (generatedAt === undefined) return "Prepared date TBD";
  return formatProposalDate(generatedAt);
}

function formatCompactMoneyRange(range: Range): string {
  const low = formatCompactMoney(range.low);
  const high = formatCompactMoney(range.high);
  if (low === high) return low;
  return `${low}–${high.replace(/^\$/, "")}`;
}

function formatApproxCompactMoneyRange(range: Range): string {
  return `~${formatCompactMoneyRange(range)}`;
}

function formatApproxCompactMoney(value: number): string {
  return `~${formatCompactMoney(value)}`;
}

function formatCompactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = value / 1_000_000;
    return `$${formatCompactNumber(millions)}M`;
  }
  if (abs >= 1_000) {
    const thousands = Math.round(value / 1_000);
    return `$${thousands.toLocaleString("en-US")}K`;
  }
  return formatMoney(value);
}

function formatCompactNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function sumRanges(ranges: readonly Range[]): Range {
  return ranges.reduce(
    (total, range) => ({ low: total.low + range.low, high: total.high + range.high }),
    { low: 0, high: 0 },
  );
}

function halveRange(range: Range): Range {
  return { low: range.low / 2, high: range.high / 2 };
}

function deliverableIcon(index: number): string {
  const icons = ["▣", "▤", "◇", "▥", "▧", "◈"] as const;
  return icons[index % icons.length] ?? "▣";
}

function isString(input: string | undefined): input is string {
  return input !== undefined && input.length > 0;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(input: string): string {
  return escapeHtml(input).replaceAll("`", "&#96;");
}

function safeCssColor(input: string): string {
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]+$/.test(trimmed)) return trimmed;
  if (/^(rgb|rgba|hsl|hsla)\([0-9%.,\s-]+\)$/.test(trimmed)) return trimmed;
  return "#111827";
}
