import { describe, expect, it } from "vitest";
import { analyzeProject } from "../core/index.js";
import { tritenExample } from "../data/defaults.js";
import { BUILT_IN_BRANDS } from "../proposal/brands.js";
import { buildProposalViewModel } from "../proposal/model.js";
import type { ProposalIntake, ProposalViewModel } from "../proposal/types.js";
import { renderProposalHtml } from "./proposalHtml.js";

describe("renderProposalHtml", () => {
  it("includes the expected client name, lead price, year-one value, and payback", () => {
    const viewModel = buildViewModel("client");
    const html = renderProposalHtml(viewModel);

    expect(html).toContain("Triten Real Estate Partners");
    expect(html).toContain(viewModel.economics.formattedLeadPrice);
    expect(html).toContain(viewModel.economics.yearOneValueRange);
    expect(html).toContain(viewModel.economics.paybackMonths);
  });

  it("keeps client audience free of internal cost-floor and margin labels", () => {
    const html = renderProposalHtml(buildViewModel("client"));

    expect(html).not.toContain("Internal appendix");
    expect(html).not.toContain("P50 cost floor");
    expect(html).not.toContain("Risk-adjusted floor");
    expect(html).not.toContain("Target margin");
  });

  it("includes appendix fields for internal audience", () => {
    const html = renderProposalHtml(buildViewModel("internal"));

    expect(html).toContain("Internal appendix: cost floor and guardrails");
    expect(html).toContain("P50 cost floor");
    expect(html).toContain("Risk-adjusted floor");
    expect(html).toContain("Target margin");
  });

  it("escapes untrusted text", () => {
    const intake = validIntake();
    const firstScope = intake.scope[0];
    if (firstScope === undefined) throw new Error("Fixture is missing a scope item.");
    const maliciousIntake: ProposalIntake = {
      ...intake,
      preparedFor: {
        ...intake.preparedFor,
        companyName: "Bad <script>alert('x')</script> & Co",
        buyerName: 'A "Buyer" & <Owner>',
      },
      details: {
        ...intake.details,
        title: "Proposal <script>bad()</script>",
        executiveSummary: ['Use <b>bold</b> & quotes "here".'],
      },
      scope: [
        {
          ...firstScope,
          title: "Scope <img src=x onerror=alert(1)>",
        },
      ],
    };
    const viewModel = buildProposalViewModel(
      maliciousIntake,
      BUILT_IN_BRANDS.nolan,
      analyzeProject(maliciousIntake.project),
      {
        audience: "client",
      },
    );
    const html = renderProposalHtml(viewModel);

    expect(html).toContain("Bad &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; Co");
    expect(html).toContain("A &quot;Buyer&quot; &amp; &lt;Owner&gt;");
    expect(html).toContain("Use &lt;b&gt;bold&lt;/b&gt; &amp; quotes &quot;here&quot;.");
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});

function buildViewModel(audience: "client" | "internal"): ProposalViewModel {
  const intake = validIntake();
  return buildProposalViewModel(intake, BUILT_IN_BRANDS.nolan, analyzeProject(intake.project), {
    audience,
    generatedAt: new Date("2026-06-05T12:00:00Z"),
  });
}

function validIntake(): ProposalIntake {
  return {
    project: tritenExample(),
    preparedFor: {
      companyName: "Triten Real Estate Partners",
      buyerName: "Triten Leadership Team",
      buyerTitle: "COO",
      website: "https://triten.com",
      logoText: "TRITEN",
    },
    details: {
      title: "AI Portfolio Intelligence Pilot",
      subtitle:
        "A focused pilot to unify Monday.com and Power BI context into an executive Q&A layer.",
      date: "June 5, 2026",
      recommendation:
        "Start with the $40K pilot build, then scope workflow agents after the data foundation proves out.",
      executiveSummary: [
        "Triten has enough manual reporting and cross-system lookup pain to justify a focused AI data pilot.",
        "The first phase should prove value through a reliable data foundation before expanding into workflow automation.",
      ],
      whatWeHeard: [
        "Teams spend recurring time pulling asset, inspection, and investor-reporting context across multiple systems.",
        "Leadership wants faster answers without creating another ungoverned reporting surface.",
      ],
      investmentSummary:
        "The recommended pilot is priced at $40K with a conservative payback under six months.",
      timelineSummary: "Pilot delivery is expected across four focused phases.",
    },
    scope: [
      {
        title: "Data foundation and reconciliation",
        description: "Create the trusted operating layer needed for AI-assisted portfolio answers.",
        deliverables: [
          "Source mapping",
          "Power BI and Monday.com ingestion",
          "Reconciliation checks",
        ],
        outcomes: ["One governed foundation for pilot Q&A"],
      },
    ],
    milestones: [
      {
        name: "Discovery and source map",
        timing: "Week 1",
        outcomes: ["Confirm data owners", "Lock pilot questions"],
      },
      {
        name: "Pilot build and handoff",
        timing: "Weeks 2–4",
        outcomes: ["Deliver working Q&A layer", "Train internal owners"],
      },
    ],
    assumptions: ["Triten provides timely access to source-system owners."],
    exclusions: ["Full accounting automation is deferred to a later phase."],
    clientInputs: ["Power BI workspace access", "Monday.com board access"],
    nextSteps: ["Approve pilot scope", "Schedule source-system kickoff"],
  };
}
