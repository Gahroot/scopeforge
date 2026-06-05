import { describe, expect, it } from "vitest";
import { tritenExample } from "../data/defaults.js";
import type { ProposalBrand, ProposalDraft } from "../proposal/types.js";
import { renderValueProposalHtml } from "./valueProposalHtml.js";

const BLACK_MOUNTAIN_BRAND = {
  id: "black-mountain",
  name: "Black Mountain Solutions",
  legalName: "Black Mountain Solutions LLC",
  tagline: "AI operating systems for real operating teams.",
  website: "blackmountain.solutions",
  email: "hello@blackmountain.solutions",
  logoText: "BMS",
  colors: {
    primary: "#03384f",
    secondary: "#0f526d",
    accent: "#0c5a7d",
    background: "#f8fafc",
    surface: "#ffffff",
    text: "#243041",
    mutedText: "#8390a3",
    border: "#dbe4ee",
  },
} satisfies ProposalBrand;

describe("renderValueProposalHtml", () => {
  it("renders the Triten-style five-page value proposal from ProposalDraft fields", () => {
    const draft = validDraft();
    const html = renderValueProposalHtml(draft, {
      brand: BLACK_MOUNTAIN_BRAND,
      generatedAt: new Date("2026-06-05T12:00:00Z"),
    });

    expect(html.match(/<section class="page/g)).toHaveLength(5);
    expect(html).toContain('data-page="cover"');
    expect(html).toContain('data-page="value-unlocks"');
    expect(html).toContain('data-page="build-plan"');
    expect(html).toContain('data-page="actual-deliverables"');
    expect(html).toContain('data-page="investment-next-steps"');

    expect(html).toContain("An AI Operating System That Pays for Itself in About 5 Months");
    expect(html).toContain("$150K–180K");
    expect(html).toContain("~2 mo");
    expect(html).toContain("01 What this unlocks for TRITEN");
    expect(html).toContain("Where recovered value comes from");
    expect(html).toContain("Team capacity returned to higher-value work");
    expect(html).toContain("Modeled source range: ~$100K–170K");
    expect(html).toContain("~$170K");
    expect(html).toContain("02 What we build");
    expect(html).toContain("03 How we keep it practical");
    expect(html).toContain("04 What you'll actually have");
    expect(html).toContain("Clean Data Layer");
    expect(html).toContain("05 Your investment");
    expect(html).toContain("Start here");
    expect(html).toContain("Standard: <s>$67K</s>");
    expect(html).toContain("06 Next steps");
    expect(html).toContain("Terms:");
    expect(html).toContain("Confidential · Page 5");
  });

  it("escapes untrusted draft and brand text", () => {
    const draft = maliciousDraft();
    const brand = {
      ...BLACK_MOUNTAIN_BRAND,
      name: "Bad <script>brand()</script> & Co",
      logoText: "BMS <svg onload=alert(1)>",
      colors: {
        ...BLACK_MOUNTAIN_BRAND.colors,
        primary: "red; background:url(javascript:alert(1))",
      },
    } satisfies ProposalBrand;
    const html = renderValueProposalHtml(draft, { brand });

    expect(html).toContain("Bad &lt;script&gt;brand()&lt;/script&gt; &amp; Co");
    expect(html).toContain("BMS &lt;svg onload=alert(1)&gt;");
    expect(html).toContain("Triten &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; Co");
    expect(html).toContain("Use &lt;b&gt;live&lt;/b&gt; data &amp; quotes &quot;here&quot;.");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>brand()</script>");
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("keeps client output free of internal metadata and cost-floor details", () => {
    const base = validDraft();
    const firstWorkstream = requiredFirst(base.project.cost.workstreams, "cost workstream");
    const draft = {
      ...base,
      metadata: {
        ...base.metadata,
        author: "Internal Pricer",
        source: "P50 cost floor worksheet",
        notes: ["P50 cost floor is $12K.", "Target margin is 40%."],
      },
      project: {
        ...base.project,
        cost: {
          ...base.project.cost,
          workstreams: [
            {
              ...firstWorkstream,
              name: "Internal margin model do not send",
            },
          ],
        },
      },
    } satisfies ProposalDraft;

    const clientHtml = renderValueProposalHtml(draft, {
      brand: BLACK_MOUNTAIN_BRAND,
      audience: "client",
    });
    const internalHtml = renderValueProposalHtml(draft, {
      brand: BLACK_MOUNTAIN_BRAND,
      audience: "internal",
    });

    expect(clientHtml).not.toContain("Internal review copy");
    expect(clientHtml).not.toContain("P50 cost floor");
    expect(clientHtml).not.toContain("Target margin");
    expect(clientHtml).not.toContain("Internal margin model do not send");
    expect(clientHtml).not.toContain("Internal Pricer");
    expect(internalHtml).toContain("Internal review copy · do not send until approved");
  });
});

function validDraft(): ProposalDraft {
  return {
    project: tritenExample(),
    templateIds: ["generic/value-proposal"],
    metadata: {
      draftId: "draft-triten-value-proposal",
      version: 1,
      status: "ready",
      createdAt: "2026-06-05T12:00:00Z",
      updatedAt: "2026-06-05T12:00:00Z",
      author: "Nolan Grout",
      source: "conversation",
      notes: ["Internal draft note that should not render in client output."],
    },
    preparedFor: {
      companyName: "Triten Real Estate Partners",
      buyerName: "Brent Ozenbaugh",
      buyerTitle: "Triten Team",
      website: "https://triten.com",
      logoText: "TRITEN",
      accentColor: "#0c5a7d",
    },
    details: {
      title: "Triten AI Operating System Value Proposal",
      subtitle:
        "This is the base the rest of the work needs. Here is what Triten has at the end of the pilot.",
      date: "June 5, 2026",
      recommendation:
        "Phase 1 is a $50K pilot. Target outcome: recover $150K–180K in team capacity and avoided busywork in the first six months.",
      executiveSummary: [
        "Triten can recover capacity by connecting operating data and reducing manual handoffs.",
      ],
      whatWeHeard: ["Manual reporting, repeated checks, and follow-up loops slow down daily work."],
      timelineSummary:
        "Connect the systems Triten already uses, clean up the numbers, and give the team one reliable place to get answers and start reports.",
    },
    valueProposal: {
      headline: "An AI Operating System That Pays for Itself in About 5 Months",
      narrative:
        "The value is giving Triten's team faster, cleaner ways to act on the information they already manage every day.",
      unlocks: [
        "More time for real work: less gathering, reconciling, and re-keying information",
        "Cleaner handoffs: everyone works from the same source of truth",
        "Better underwriting visibility: deal metrics can be compared quickly across files",
        "Leadership clarity: executives see what matters without creating one-off work",
        "Faster decisions: portfolio questions get answered while there is still time to act",
        "Easier reporting: drafts start from live, trusted data instead of manual exports",
        "Less follow-up fatigue: fewer duplicate requests, missing details, and status checks",
        "Faster ramp for employees: new hires learn from a searchable operating system",
      ],
      valueSources: [
        {
          label: "Team capacity returned to higher-value work",
          source: "analysts, asset managers, finance/ops, and execs get hours back",
          currentState: "~22 people spend 1–2.5 hrs/wk each gathering and reconciling data.",
          futureState: "Capacity is conservatively realized for judgment, planning, and execution.",
          annualValue: { low: 70_000, high: 105_000 },
          confidence: "medium",
        },
        {
          label: "Investor reports built faster",
          source: "Discovery estimate",
          currentState: "Manual drafts, variance checks, and package-prep loops repeat each cycle.",
          futureState: "Drafts start from live, trusted data instead of manual exports.",
          annualValue: { low: 5_000, high: 15_000 },
          confidence: "medium",
        },
        {
          label: "Underwriting review streamlined",
          source: "ScopeForge value model",
          currentState: "100+ deal files are hard to search, compare, and reuse.",
          futureState: "Deal metrics can be retrieved and compared quickly across files.",
          annualValue: { low: 15_000, high: 30_000 },
          confidence: "high",
        },
        {
          label: "Pipeline and inspection workflows cleaned up",
          source: "Discovery estimate",
          currentState: "Duplicate entries, missing details, and follow-up loops create busywork.",
          futureState: "Pipeline and inspection context comes from a cleaner operating base.",
          annualValue: { low: 10_000, high: 20_000 },
          confidence: "medium",
        },
      ],
      sixMonthSavings: { low: 150_000, high: 180_000 },
      annualValueTarget: 170_000,
    },
    buildPlan: [
      {
        name: "Existing systems",
        timing: "Step 1",
        description:
          "Use the tools Triten already works in. No new system of record forced on the team.",
        activities: ["Yardi", "Power BI", "Monday", "Docs"],
        outcomes: ["Known sources", "No replacement mandate"],
      },
      {
        name: "Clean data layer",
        timing: "Step 2",
        description:
          "Match entities, remove duplicates, reconcile figures, and keep a record of what changed.",
        activities: ["clean", "checked", "tracked"],
        outcomes: ["Trusted data", "Change history"],
      },
      {
        name: "Controlled access layer",
        timing: "Step 3",
        description:
          "The MCP server lets approved tools pull live portfolio data with clear permissions.",
        activities: ["roles", "sources", "logs"],
        outcomes: ["Controlled access", "Source tracking"],
      },
      {
        name: "Daily work",
        timing: "Step 4",
        description:
          "Questions, reports, underwriting pulls, alerts, and AI-first tools run from the same clean base.",
        activities: ["answers", "reports", "alerts"],
        outcomes: ["Daily leverage", "Fewer handoffs"],
      },
    ],
    actualDeliverables: [
      {
        title: "Clean Data Layer",
        description:
          "Yardi, Power BI, Monday, loan and lease abstracts, inspections, and financials in one reconciled place.",
        included: ["Scheduled syncs", "Change history", "Reconciliation checks"],
      },
      {
        title: "The Triten MCP Server",
        description:
          "A controlled way for approved tools to use live portfolio data directly without manual exports.",
        included: ["Approved-tool access", "Source tracking", "Activity logs"],
      },
      {
        title: "Plain-English Portfolio Q&A",
        description:
          "Ask a normal question and get a sourced answer with the chart or number behind it.",
        included: ["Priority question flows", "Sourced answers"],
        acceptanceCriteria: ["What's NOI across all IOS assets in Q1?"],
      },
      {
        title: "Faster Reporting",
        description:
          "Investor-report drafts, management updates, and variance notes start from live data.",
        included: ["Draft report starts", "Variance-note support"],
      },
      {
        title: "Access and Trust",
        description:
          "Role-based access, clear source links, and activity logs so the team knows where answers came from.",
        included: ["Role-based access", "Clear source links"],
      },
      {
        title: "A Base That Keeps Paying Off",
        description:
          "Document search, underwriting pulls, CapEx forecasting, and alerts get easier once the data layer is in place.",
        included: ["Phase 2 backlog", "Reusable platform base"],
      },
    ],
    pricing: {
      summary:
        "A clear three-phase path: a fixed-price pilot paid up front, an estimated Phase 2 after the foundation is proven, and a Phase 3 roadmap once Triten has the AI-first foundation in place.",
      phases: [
        {
          name: "Pilot Build",
          price: 50_000,
          discounts: [
            {
              label: "Existing Client Referral Discount (25%)",
              amount: 17_000,
              reason: "Applied to the Phase 1 pilot.",
            },
          ],
          note: "paid up front",
        },
        {
          name: "Reporting + Workflows",
          price: 100_000,
          note: "estimated and confirmed after the pilot",
        },
        {
          name: "What This Unlocks",
          price: null,
          note: "Scoped when ready",
        },
      ],
    },
    terms: {
      paymentTerms:
        "$50K net after referral discount, paid up front; 30 days support included; usage/licenses billed separately.",
      startConditions: ["Approve the Phase 1 pilot scope and investment."],
      assumptions: [
        "The system is only useful if the data is right. We reconcile source systems before asking anyone to trust the output.",
      ],
      exclusions: ["Usage/licenses billed separately."],
      clientResponsibilities: [
        "Triten's team controls judgment, review, and final decisions while the software speeds up the work.",
      ],
      changeControl:
        "The custom foundation keeps Triten flexible as AI capabilities keep advancing. Once operating data is clean, the roadmap can shift more repetitive work to AI while people stay focused on judgment, relationships, and deals.",
      expiration: "Valid for 30 days from proposal date.",
    },
    footer: {
      confidentiality: "Confidential",
      contact: "blackmountain.solutions",
      legal: "Continuous Phase 1 support is available separately.",
    },
    nextSteps: [
      "Align on the pilot: Confirm scope and the one or two workflows we prove first on a 30-minute call.",
      "Confirm access & kick off: Connect to Power BI, Yardi, and Monday and stand up the data model.",
    ],
  };
}

function maliciousDraft(): ProposalDraft {
  const draft = validDraft();
  const firstValueSource = requiredFirst(draft.valueProposal.valueSources, "value source");
  const firstBuildStep = requiredFirst(draft.buildPlan, "build-plan step");
  const firstDeliverable = requiredFirst(draft.actualDeliverables, "actual deliverable");
  const firstPhase = requiredFirst(draft.pricing.phases, "pricing phase");
  return {
    ...draft,
    preparedFor: {
      ...draft.preparedFor,
      companyName: "Triten <script>alert('x')</script> & Co",
      buyerName: 'A "Buyer" & <Owner>',
      logoText: "TRI <img src=x onerror=alert(1)>",
    },
    details: {
      ...draft.details,
      title: "Proposal <script>bad()</script>",
      recommendation: 'Use <b>live</b> data & quotes "here".',
    },
    valueProposal: {
      ...draft.valueProposal,
      headline: "Bad <script>headline()</script>",
      narrative: "Narrative <iframe src=x></iframe>",
      unlocks: ["More time: <img src=x onerror=alert(1)>"],
      valueSources: [
        {
          ...firstValueSource,
          label: "Value <svg onload=alert(1)>",
          source: "Source <script>source()</script>",
          currentState: "Current <b>state</b>",
          futureState: "Future & trusted <state>",
        },
      ],
    },
    buildPlan: [
      {
        ...firstBuildStep,
        name: "Step <script>step()</script>",
        description: "Do <img src=x onerror=alert(2)> safely.",
        activities: ["Activity <b>one</b>"],
        outcomes: ["Outcome & <two>"],
      },
    ],
    actualDeliverables: [
      {
        ...firstDeliverable,
        title: "Deliverable <script>deliver()</script>",
        description: "Description <b>bold</b>",
        included: ["Included <img src=x onerror=alert(1)>"],
        acceptanceCriteria: ["Criteria <script>criteria()</script>"],
      },
    ],
    pricing: {
      ...draft.pricing,
      summary: "Summary <script>price()</script>",
      phases: [
        {
          ...firstPhase,
          name: "Phase <script>phase()</script>",
          note: "Note <b>phase</b>",
          discounts: [
            {
              label: "Discount <script>discount()</script>",
              amount: 1_000,
              reason: "Reason <b>discount</b>",
            },
          ],
        },
      ],
    },
    terms: {
      ...draft.terms,
      paymentTerms: "Terms <script>terms()</script>",
      exclusions: ["Exclude <img src=x onerror=alert(3)>"],
      clientResponsibilities: ["Responsibility <svg onload=alert(4)>"],
      changeControl: "Change <script>change()</script>",
    },
    footer: {
      confidentiality: "Confidential <script>footer()</script>",
      contact: "Contact <b>bad</b>",
      legal: "Legal & <bad>",
    },
    nextSteps: ["Next <script>next()</script>: Detail <b>next</b>"],
  };
}

function requiredFirst<T>(items: readonly T[], label: string): T {
  const item = items[0];
  if (item === undefined) throw new Error(`Fixture is missing ${label}.`);
  return item;
}
