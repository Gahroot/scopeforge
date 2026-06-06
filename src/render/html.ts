/**
 * Presentation-layer renderer for a client-ready `Proposal`.
 *
 * `renderProposalHtml` is a pure, deterministic function: it produces a single,
 * self-contained, print-ready HTML document (inline `<style>`, `@page` + `@media
 * print` rules) reproducing the six-section layout of the delivered Triten value
 * proposal:
 *
 *   1. Cover with headline stats (savings target, payback, one-system summary)
 *   2. What This Unlocks + year-one savings table + savings ramp
 *   3. What We Build
 *   4. What You'll Actually Have / deliverables
 *   5. Your Investment — phased discounted pricing (gross → discount → net)
 *   6. Next Steps + terms
 *
 * Every number is pulled from `proposal.analysis` / `proposal.project`; nothing
 * numeric is hardcoded. All interpolated text is HTML-escaped. The function never
 * calls `Date.now()` or `Math.random()`, so output is byte-for-byte reproducible.
 */

import type { Range, Tier } from "../core/types.js";
import { formatMoney, formatMoneyRange, formatPercent } from "../proposal/format.js";
import type { NarrativeSection, Proposal } from "../proposal/types.js";
import { escapeHtml } from "./htmlEscape.js";

export function renderProposalHtml(proposal: Proposal): string {
  const { meta, project } = proposal;
  const docTitle = `${meta.engagement} — ${meta.vendor}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(docTitle)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <main class="proposal">
${renderCover(proposal)}
${renderUnlocks(proposal)}
${renderWhatWeBuild(proposal.whatWeBuild)}
${renderDeliverables(proposal.deliverables)}
${renderInvestment(project.pricing.tiers, project.pricing.phases ?? [], project.pricing.terms)}
${renderNextSteps(proposal)}
  </main>
</body>
</html>`;
}

// ---- Section 1: cover -------------------------------------------------------

function renderCover(proposal: Proposal): string {
  const { meta, headline } = proposal;
  return `    <section class="page cover">
      <div class="cover-top">
        <div class="brand">${escapeHtml(meta.vendor)}</div>
        ${meta.confidential ? `<span class="badge">Confidential</span>` : ""}
      </div>
      <div class="cover-main">
        <p class="eyebrow">Prepared for ${escapeHtml(meta.recipient)}</p>
        <h1>${escapeHtml(meta.engagement)}</h1>
        <p class="lead">${escapeHtml(headline.summary)}</p>
        <div class="stat-strip">
          ${statCard("Year-one savings target", headline.savingsTarget)}
          ${statCard("Payback", headline.payback)}
          ${statCard("One system of record", "Source of truth")}
        </div>
      </div>
      <div class="cover-foot">
        ${coverMeta("Prepared by", meta.vendor)}
        ${coverMeta("Engagement", meta.engagement)}
        ${coverMeta("Date", meta.date)}
      </div>
    </section>`;
}

// ---- Section 2: unlocks + year-one savings + ramp ---------------------------

function renderUnlocks(proposal: Proposal): string {
  const { unlocks, analysis, project } = proposal;
  const intro = unlocks[0];
  const rest = unlocks.slice(1);

  return `    <section class="page">
      <header class="section-head">
        <p class="eyebrow">The opportunity</p>
        <h2>${escapeHtml(intro?.heading ?? "What This Unlocks")}</h2>
      </header>
      ${intro ? narrativeBody(intro) : ""}
      ${savingsTable(analysis.value.realizedTime, analysis.value.workflows, analysis.value.yearOne)}
      ${savingsRamp(project.value.ramp ?? [])}
      ${rest.map(narrativeBlock).join("\n      ")}
    </section>`;
}

function savingsTable(realizedTime: Range, workflows: Range, yearOne: Range): string {
  const rows = [
    ["Team capacity returned to higher-value work", formatMoneyRange(realizedTime)],
    ["Faster reporting & cleaner workflows", formatMoneyRange(workflows)],
  ] as const;
  return `<figure class="block">
        <figcaption>Where year-one savings come from</figcaption>
        <table class="data">
          <thead><tr><th scope="col">Source</th><th scope="col">Year-one value</th></tr></thead>
          <tbody>
            ${rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(value)}</td></tr>`).join("\n            ")}
            <tr class="total"><th scope="row">Conservative year-one recurring savings</th><td class="num">${escapeHtml(formatMoneyRange(yearOne))}</td></tr>
          </tbody>
        </table>
      </figure>`;
}

function savingsRamp(ramp: readonly { year: number; low: number; high: number; label?: string }[]): string {
  if (ramp.length === 0) return "";
  const maxHigh = ramp.reduce((max, year) => Math.max(max, year.high), 0);
  const bars = ramp
    .map((year) => {
      const pct = maxHigh > 0 ? Math.round((year.high / maxHigh) * 100) : 0;
      const amount = year.low === year.high ? `${formatMoney(year.low)}+` : formatMoneyRange(year);
      return `<li class="ramp-row">
            <span class="ramp-year">Year ${escapeHtml(String(year.year))}</span>
            <span class="ramp-track"><span class="ramp-fill" style="width:${pct}%"></span></span>
            <span class="ramp-amount">${escapeHtml(amount)}</span>
            ${year.label ? `<span class="ramp-label">${escapeHtml(year.label)}</span>` : ""}
          </li>`;
    })
    .join("\n          ");
  return `<figure class="block">
        <figcaption>How the savings ramp</figcaption>
        <ul class="ramp">
          ${bars}
        </ul>
      </figure>`;
}

// ---- Section 3: what we build -----------------------------------------------

function renderWhatWeBuild(sections: readonly NarrativeSection[]): string {
  const head = sections[0];
  const rest = sections.slice(1);
  return `    <section class="page">
      <header class="section-head">
        <p class="eyebrow">Approach</p>
        <h2>${escapeHtml(head?.heading ?? "What We Build")}</h2>
      </header>
      ${head ? narrativeBody(head) : ""}
      ${rest.map(narrativeBlock).join("\n      ")}
    </section>`;
}

// ---- Section 4: deliverables ------------------------------------------------

function renderDeliverables(sections: readonly NarrativeSection[]): string {
  const head = sections[0];
  const rest = sections.slice(1);
  return `    <section class="page">
      <header class="section-head">
        <p class="eyebrow">Deliverables</p>
        <h2>${escapeHtml(head?.heading ?? "What You'll Actually Have")}</h2>
      </header>
      ${head ? narrativeBody(head) : ""}
      ${rest.map(narrativeBlock).join("\n      ")}
    </section>`;
}

// ---- Section 5: investment (gross → discount → net) -------------------------

function renderInvestment(
  tiers: readonly Tier[],
  phases: readonly { name: string; status: string; deliverables: readonly string[]; note?: string }[],
  terms: Proposal["project"]["pricing"]["terms"],
): string {
  const cards = tiers
    .map((tier, index) => investmentCard(tier, phases[index]))
    .join("\n        ");
  return `    <section class="page">
      <header class="section-head">
        <p class="eyebrow">Investment</p>
        <h2>Your Investment</h2>
      </header>
      <div class="phases">
        ${cards}
      </div>
      ${terms ? termsBlock(terms) : ""}
    </section>`;
}

function investmentCard(
  tier: Tier,
  phase: { name: string; status: string; deliverables: readonly string[]; note?: string } | undefined,
): string {
  const deliverables = phase?.deliverables ?? [];
  const statusLabel = phase ? phase.status : tier.price === null ? "open" : "fixed";
  return `<article class="phase phase-${escapeHtml(statusLabel)}">
          <header class="phase-head">
            <h3>${escapeHtml(tier.name)}</h3>
            <span class="status">${escapeHtml(statusLabel)}</span>
          </header>
          ${priceChain(tier)}
          ${
            deliverables.length > 0
              ? `<ul class="phase-deliverables">${deliverables.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
              : ""
          }
          ${tier.note ? `<p class="note">${escapeHtml(tier.note)}</p>` : ""}
        </article>`;
}

function priceChain(tier: Tier): string {
  if (tier.price === null) {
    return `<p class="price-line"><span class="price net">Scoped when ready</span></p>`;
  }
  const hasDiscount = tier.standardPrice !== undefined && tier.discountPct !== undefined;
  if (!hasDiscount) {
    return `<p class="price-line"><span class="price net">${escapeHtml(formatMoney(tier.price))}</span></p>`;
  }
  const gross = tier.standardPrice as number;
  const discountPct = tier.discountPct as number;
  const discountAmount = gross - tier.price;
  return `<dl class="price-chain">
            <div><dt>Standard build</dt><dd class="num gross">${escapeHtml(formatMoney(gross))}</dd></div>
            <div><dt>Referral discount (${escapeHtml(formatPercent(discountPct))})</dt><dd class="num discount">−${escapeHtml(formatMoney(discountAmount))}</dd></div>
            <div class="net-row"><dt>Net${tier.paidUpFront ? ", paid up front" : ""}</dt><dd class="num net">${escapeHtml(formatMoney(tier.price))}</dd></div>
          </dl>`;
}

function termsBlock(terms: NonNullable<Proposal["project"]["pricing"]["terms"]>): string {
  const items: string[] = [];
  if (terms.supportIncludedDays !== undefined) {
    items.push(`${escapeHtml(String(terms.supportIncludedDays))} days of post-launch support included`);
  }
  if (terms.supportMonthly !== undefined) {
    items.push(`Continuous support retainer ${escapeHtml(formatMoney(terms.supportMonthly))}/mo`);
  }
  if (terms.usageBilledSeparately) {
    items.push("Usage and licenses billed separately");
  }
  if (items.length === 0 && terms.note === undefined) return "";
  return `<div class="terms">
        <h3>Terms</h3>
        ${items.length > 0 ? `<ul class="bullets">${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : ""}
        ${terms.note ? `<p class="note">${escapeHtml(terms.note)}</p>` : ""}
      </div>`;
}

// ---- Section 6: next steps + footer terms -----------------------------------

function renderNextSteps(proposal: Proposal): string {
  const { project, meta } = proposal;
  const tiers = project.pricing.tiers;
  const firstPriced = tiers.find((tier) => tier.price !== null);
  const steps: string[] = [];
  if (firstPriced && firstPriced.price !== null) {
    steps.push(
      `Approve ${escapeHtml(firstPriced.name)} at ${escapeHtml(formatMoney(firstPriced.price))}${firstPriced.paidUpFront ? ", paid up front" : ""}.`,
    );
  }
  steps.push("Confirm source-system access so we can start the foundation immediately.");
  steps.push("Kick off discovery and the source-of-truth data model.");

  return `    <section class="page">
      <header class="section-head">
        <p class="eyebrow">Getting started</p>
        <h2>Next Steps</h2>
      </header>
      <ol class="steps">
        ${steps.map((step) => `<li>${step}</li>`).join("\n        ")}
      </ol>
      <p class="closing">Prepared by ${escapeHtml(meta.vendor)} for ${escapeHtml(meta.recipient)} · ${escapeHtml(meta.date)}.</p>
      ${meta.confidential ? `<p class="fine-print">Confidential — for the intended recipient only.</p>` : ""}
    </section>`;
}

// ---- Shared renderers -------------------------------------------------------

function narrativeBlock(section: NarrativeSection): string {
  return `<div class="block">
        <h3>${escapeHtml(section.heading)}</h3>
        ${narrativeBody(section)}
      </div>`;
}

function narrativeBody(section: NarrativeSection): string {
  const parts: string[] = [];
  if (section.body) parts.push(`<p>${escapeHtml(section.body)}</p>`);
  if (section.bullets && section.bullets.length > 0) {
    parts.push(
      `<ul class="bullets">${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
    );
  }
  return parts.join("\n        ");
}

function statCard(label: string, value: string): string {
  return `<div class="stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span></div>`;
}

function coverMeta(label: string, value: string): string {
  return `<div class="meta"><span class="meta-label">${escapeHtml(label)}</span><span class="meta-value">${escapeHtml(value)}</span></div>`;
}

// ---- Styles -----------------------------------------------------------------

const STYLES = `
    @page { size: Letter; margin: 0.6in; }
    * { box-sizing: border-box; }
    html {
      color: #0f172a;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { margin: 0; background: #f1f5f9; }
    h1 { font-size: 30px; margin: 0 0 16px; line-height: 1.15; }
    h2 { font-size: 22px; margin: 0; }
    h3 { font-size: 16px; margin: 0 0 8px; }
    p { margin: 0 0 12px; }
    .proposal { max-width: 920px; margin: 0 auto; padding: 24px; }
    .page {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);
      margin: 0 0 24px;
      padding: 44px;
      page-break-after: always;
      break-after: page;
    }
    .page:last-child { page-break-after: auto; break-after: auto; }
    .eyebrow {
      color: #2563eb; font-size: 12px; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 8px;
    }
    .section-head { margin-bottom: 20px; }
    .block { margin: 22px 0; page-break-inside: avoid; break-inside: avoid; }
    figcaption, .block > h3 { font-weight: 700; margin-bottom: 10px; }
    .bullets { margin: 8px 0 0; padding-left: 20px; }
    .bullets li { margin: 4px 0; }

    /* Cover */
    .cover {
      display: grid; grid-template-rows: auto 1fr auto; min-height: 9in;
      background: linear-gradient(160deg, #eef2ff, #ffffff 55%);
    }
    .cover-top { display: flex; justify-content: space-between; align-items: center; }
    .brand { font-weight: 800; letter-spacing: 0.04em; font-size: 18px; }
    .badge {
      border: 1px solid #cbd5e1; border-radius: 999px; padding: 4px 12px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569;
    }
    .cover-main { align-self: center; }
    .lead { font-size: 16px; color: #334155; max-width: 60ch; }
    .stat-strip { display: flex; gap: 16px; margin-top: 28px; flex-wrap: wrap; }
    .stat {
      flex: 1 1 180px; background: #0f172a; color: #fff; border-radius: 12px;
      padding: 18px 20px; display: flex; flex-direction: column; gap: 6px;
    }
    .stat-value { font-size: 22px; font-weight: 800; }
    .stat-label { font-size: 12px; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.08em; }
    .cover-foot { display: flex; gap: 32px; border-top: 1px solid #e2e8f0; padding-top: 18px; }
    .meta { display: flex; flex-direction: column; gap: 2px; }
    .meta-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
    .meta-value { font-weight: 600; }

    /* Tables */
    table.data { width: 100%; border-collapse: collapse; font-size: 14px; }
    table.data th, table.data td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
    table.data thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    table.data .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.data tr.total td, table.data tr.total th { border-top: 2px solid #0f172a; border-bottom: none; font-weight: 800; }

    /* Ramp */
    .ramp { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
    .ramp-row { display: grid; grid-template-columns: 70px 1fr auto; align-items: center; gap: 12px; }
    .ramp-year { font-weight: 700; }
    .ramp-track { background: #e2e8f0; border-radius: 999px; height: 14px; overflow: hidden; }
    .ramp-fill { display: block; height: 100%; background: linear-gradient(90deg, #2563eb, #38bdf8); }
    .ramp-amount { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ramp-label { grid-column: 2 / 4; font-size: 12px; color: #64748b; }

    /* Investment */
    .phases { display: grid; gap: 18px; }
    .phase {
      border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px;
      page-break-inside: avoid; break-inside: avoid;
    }
    .phase-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .phase-head h3 { margin: 0; }
    .status {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700;
      border-radius: 999px; padding: 3px 10px; background: #e2e8f0; color: #475569;
    }
    .phase-fixed { border-color: #2563eb; }
    .phase-fixed .status { background: #dbeafe; color: #1d4ed8; }
    .phase-open { border-style: dashed; }
    .price-line { margin: 12px 0; }
    .price-chain { margin: 12px 0; display: grid; gap: 4px; }
    .price-chain div { display: flex; justify-content: space-between; gap: 16px; }
    .price-chain dt { color: #475569; }
    .price-chain dd { margin: 0; font-variant-numeric: tabular-nums; }
    .price-chain .net-row { border-top: 1px solid #e2e8f0; padding-top: 6px; margin-top: 2px; font-weight: 800; }
    .price.net { font-size: 20px; font-weight: 800; }
    .gross { color: #64748b; }
    .discount { color: #15803d; }
    .phase-deliverables { margin: 8px 0 0; padding-left: 20px; columns: 2; font-size: 13px; }
    .phase-deliverables li { margin: 3px 0; break-inside: avoid; }
    .note { font-size: 12px; color: #64748b; margin: 10px 0 0; }

    .terms { margin-top: 26px; border-top: 1px solid #e2e8f0; padding-top: 18px; page-break-inside: avoid; break-inside: avoid; }
    .steps { padding-left: 22px; }
    .steps li { margin: 8px 0; }
    .closing { margin-top: 24px; font-weight: 600; }
    .fine-print { font-size: 11px; color: #94a3b8; }

    @media screen { body { padding: 24px 0; } }
    @media print {
      body { background: #fff; padding: 0; }
      .proposal { max-width: none; padding: 0; }
      .page { border-radius: 0; box-shadow: none; margin: 0; padding: 0.1in 0; min-height: auto; }
      .cover { min-height: calc(11in - 1.2in); }
    }
`;
