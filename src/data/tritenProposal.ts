/**
 * The Triten engagement as a full, render-ready `Proposal`.
 *
 * Composes the `tritenExample()` fixture (extended with the real proposal's
 * ramp / phases / terms / discounted pricing) with its deterministic
 * `analyzeProject` result and the hand-authored narrative transcribed from the
 * delivered document (Triten_Value_Proposal.pdf, "Phase 1: Foundational
 * Infrastructure", Black Mountain Solutions, June 5, 2026).
 */

import { analyzeProject } from "../core/index.js";
import type { Project } from "../core/types.js";
import type { Proposal } from "../proposal/types.js";
import { tritenExample } from "./defaults.js";

/** The Triten project, extended to match the delivered three-phase proposal. */
function tritenProposalProject(): Project {
  const base = tritenExample();
  return {
    ...base,
    value: {
      ...base.value,
      // Multi-year recurring-savings ramp. Year 2 ("$200K+") is modelled as
      // low === high per the `RampYear` contract.
      ramp: [
        {
          year: 1,
          low: 150000,
          high: 180000,
          label: "Half-team usage plus early reporting and scaling-capacity wins",
        },
        {
          year: 2,
          low: 200000,
          high: 200000,
          label: "Broader adoption and more repeatable workflows",
        },
        {
          year: 3,
          low: 275000,
          high: 325000,
          label: "Mature AI operating system across the business",
        },
      ],
    },
    pricing: {
      ...base.pricing,
      tiers: [
        {
          name: "Phase 1: Foundational Infrastructure",
          price: 50000,
          standardPrice: 75000,
          discountPct: 0.33,
          paidUpFront: true,
          note: "Standard build ~$75K; existing client referral discount (33%) ~−$25K; $50K net, paid up front.",
        },
        {
          name: "Phase 2 — Reporting + Workflows",
          price: 100000,
          standardPrice: 150000,
          discountPct: 0.33,
          note: "Standard build ~$150K; existing client referral discount (33%) ~−$50K; ~$100K estimated, confirmed after the foundation.",
        },
        {
          name: "Phase 3 — AI-First Operations",
          price: null,
          note: "Deliberately unpriced; scoped when ready as Triten's AI-first foundation matures.",
        },
      ],
      phases: [
        {
          name: "Phase 1: Foundational Infrastructure",
          status: "fixed",
          price: 50000,
          deliverables: [
            "Source-of-truth data layer",
            "Power BI / Yardi / Monday ingestion",
            "The Triten MCP server",
            "Plain-English portfolio Q&A",
            "Access controls and activity logs",
            "30 days of post-launch support included",
          ],
          note: "Standard build ~$75K; existing client referral discount (33%) ~−$25K; $50K net, paid up front.",
        },
        {
          name: "Phase 2 — Build On It: Reporting + Workflows",
          status: "estimated",
          price: 100000,
          deliverables: [
            "Custom Triten work assistant",
            "Report drafting & summaries",
            "Meeting summaries: decisions, owners, due dates",
            "Underwriting metric pulls",
            "Inspection / pipeline workflows",
            "Missing-data and issue alerts",
          ],
          note: "Standard build ~$150K; existing client referral discount (33%) ~−$50K; ~$100K estimated. Confirmed after the foundation.",
        },
        {
          name: "Phase 3 — AI-First Operations",
          status: "open",
          price: null,
          deliverables: [
            "SOP and policy helper",
            "Document query (memos, loan docs)",
            "Portfolio-wide lease & loan abstraction",
            "Insurance deficiency tracking",
            "Financial anomaly detection",
            "Easefolio implementation",
            "Automated accounting",
            "Live investor portals",
            "People fully focused on relationships and closing deals",
          ],
          note: "Deliberately unpriced. AI is evolving so fast that scoping it now risks overbuilding; keeping the foundation flexible lets Triten adopt each capability at the right moment.",
        },
      ],
      terms: {
        supportMonthly: 3000,
        supportIncludedDays: 30,
        usageBilledSeparately: true,
        note: "$50K net after referral discount, paid up front; 30 days support included; continuous Phase 1 support $3K/mo; usage/licenses billed separately.",
      },
    },
  };
}

/** The full Triten value proposal, render-ready. */
export function tritenProposal(): Proposal {
  const project = tritenProposalProject();
  const analysis = analyzeProject(project);

  return {
    meta: {
      vendor: "Black Mountain Solutions",
      recipient: "Brent Ozenbaugh and the Triten Team",
      engagement: "Phase 1: Foundational Infrastructure",
      date: "June 5, 2026",
      confidential: true,
    },
    project,
    analysis,
    headline: {
      savingsTarget: "$150K-180K/yr",
      payback: "~6 mo",
      summary:
        "Phase 1 is $50K of foundational infrastructure: Triten's source of truth and foundational AI system of record for the business. Built to create recurring savings and help Triten keep scaling with the team it already has.",
    },
    unlocks: [
      {
        heading: "What This Unlocks for Triten",
        body: "Faster, cleaner ways to act on the information you already manage every day. By connecting operating data and reducing manual handoffs, the foundation turns scattered information into a business source of truth.",
        bullets: [
          "More time for real work: less gathering, reconciling, and re-keying information",
          "Cleaner handoffs: everyone works from the same source of truth and system of record",
          "Better underwriting visibility: deal metrics can be compared quickly across files",
          "Leadership clarity: executives see what matters without creating one-off work",
          "Faster decisions: portfolio questions get answered while there is still time to act",
          "Easier reporting: drafts start from live, trusted data instead of manual exports",
          "Less follow-up fatigue: fewer duplicate requests, missing details, and status checks",
          "Faster ramp for employees: new hires learn from a searchable operating system",
        ],
      },
      {
        heading: "Where Year-One Savings Come From",
        body: "These are conservative recurring year-one numbers. They do not assume headcount cuts or full adoption.",
        bullets: [
          "Team capacity returned to higher-value work: ~22 people × ~1 hr/wk, using conservative loaded salary averages — $80K–100K/yr",
          "Scaling capacity without an immediate hire: existing team absorbs more volume instead of adding a role just to keep up — $35K–40K/yr",
          "Investor and management reports built faster: fewer manual drafts, variance checks, and package-prep loops — $15K–20K/yr",
          "Underwriting, pipeline, and inspection workflows cleaned up: fewer duplicate entries, missing details, and follow-up loops — $15K–20K/yr",
          "Conservative year-one recurring savings target: ~$150K–180K/yr, with potential $200K+ in year two and $275K–325K+ by year three",
        ],
      },
      {
        heading: "How the Savings Ramp",
        body: "Year one stays grounded in half-team usage and a few proven workflows; the recurring savings base compounds as adoption expands.",
        bullets: [
          "Year 1: half-team usage plus early reporting and scaling-capacity wins — $150K–180K/yr",
          "Year 2: broader adoption and more repeatable workflows — $200K+/yr",
          "Year 3: mature AI operating system across the business — $275K–325K+/yr",
        ],
      },
    ],
    whatWeBuild: [
      {
        heading: "What We Build",
        body: "Triten's source of truth is built on real operating data. The point is simple: connect the systems they already use, clean up the numbers, and give the team one reliable system of record for answers, reports, and AI-powered work.",
        bullets: [
          "Existing systems: keep Yardi, Power BI, Monday, and docs in place; Phase 1 becomes the connective business system of record across them.",
          "Source-of-truth layer: match entities, remove duplicates, reconcile figures, and keep a record of what changed.",
          "Controlled access layer: the MCP server lets approved tools pull live portfolio data with clear permissions and source tracking.",
          "Daily work: questions, reports, underwriting pulls, alerts, and AI-first tools all run from the same source of truth.",
        ],
      },
      {
        heading: "Built to Last",
        bullets: [
          "Built from scratch: Triten owns the codebase and data model. It can grow with the business instead of getting thrown away.",
          "Easy to change: if a better model, tool, or data source comes along, it can be swapped in without rebuilding the whole system.",
          "Access is controlled: people only see what they should see. Sources and activity are tracked so the team can trust the output.",
          "Answers are checked: financial and portfolio answers are tested against known examples before the team relies on them.",
          "Built on stable access: we use supported exports and APIs wherever possible, not brittle screen-scraping of critical systems.",
          "AI-first work becomes possible: once the data is clean, AI can handle the repetitive 80–90% so people stay focused on relationships, judgment, and closing deals.",
        ],
      },
      {
        heading: "How We Keep It Practical",
        bullets: [
          "Clean numbers first: the system is only useful if the data is right. We reconcile the source systems before asking anyone to trust the output.",
          "People still make the calls: the software speeds up the work. Triten's team still controls the judgment, review, and final decisions.",
          "Partners, not vendors — we work like part of your team. Hands-on, fast to respond, and deeply committed to the long-term success of your business.",
        ],
      },
    ],
    deliverables: [
      {
        heading: "What You'll Actually Have",
        body: "One clean place to answer portfolio questions, build reports, and cut the manual back-and-forth. This is the base the rest of the work needs. Here is what Triten has at the end of Phase 1.",
        bullets: [
          "Source-of-Truth Data Layer: Yardi, Power BI, Monday, loan and lease abstracts, inspections, and financials in one reconciled place with scheduled syncs and change history.",
          "The Triten MCP Server: a controlled way for approved tools to use live portfolio data directly. No more manual exports or copy-paste workflows.",
          "Plain-English Portfolio Q&A: ask a normal question and get a sourced answer with the chart or number behind it, across every asset.",
          "Faster Reporting: investor-report drafts, management updates, and variance notes start from live data instead of a blank page and a pile of exports.",
          "Access and Trust: role-based access, clear source links, and activity logs so the team knows where answers came from and who can see what.",
          "A System of Record That Keeps Paying Off: document search, underwriting pulls, CapEx forecasting, and alerts all get easier once the data layer is in place.",
        ],
      },
    ],
  };
}
