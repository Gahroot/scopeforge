import { describe, expect, it } from "vitest";

import { tritenProposal } from "../src/data/tritenProposal.js";
import { renderProposalHtml } from "../src/render/html.js";

describe("renderProposalHtml", () => {
  it("produces a complete, self-contained, print-ready HTML document", () => {
    const html = renderProposalHtml(tritenProposal());

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("@page");
    expect(html).toContain("@media print");
    expect(html).toContain("page-break-inside: avoid");
  });

  it("renders the cover headline figures", () => {
    const proposal = tritenProposal();
    const html = renderProposalHtml(proposal);

    expect(html).toContain(proposal.headline.savingsTarget);
    expect(html).toContain(proposal.headline.payback);
    expect(html).toContain("Black Mountain Solutions");
    expect(html).toContain("Brent Ozenbaugh and the Triten Team");
  });

  it("renders each pricing phase with the gross → discount → net chain", () => {
    const proposal = tritenProposal();
    const html = renderProposalHtml(proposal);

    for (const tier of proposal.project.pricing.tiers) {
      expect(html).toContain(tier.name);
    }
    // Phase 1 net price.
    expect(html).toContain("$50,000");
    // Phase 1 gross/list before discount.
    expect(html).toContain("$75,000");
    // Phase 2 net price.
    expect(html).toContain("$100,000");
    // Discount expressed as a percentage.
    expect(html).toContain("33%");
    // Unpriced phase is scoped later, never $0.
    expect(html).toContain("Scoped when ready");
  });

  it("renders the multi-year savings ramp", () => {
    const proposal = tritenProposal();
    const html = renderProposalHtml(proposal);

    for (const year of proposal.project.value.ramp ?? []) {
      expect(html).toContain(`Year ${year.year}`);
    }
    // Year 2 open-ended target ($200K+).
    expect(html).toContain("$200,000+");
  });

  it("renders the continuing-support terms", () => {
    const html = renderProposalHtml(tritenProposal());

    expect(html).toContain("$3,000");
    expect(html).toContain("Usage and licenses billed separately");
  });

  it("escapes interpolated text", () => {
    const base = tritenProposal();
    const proposal = {
      ...base,
      meta: { ...base.meta, recipient: "Bad <script>alert('x')</script> & Co" },
    };
    const html = renderProposalHtml(proposal);

    expect(html).toContain("Bad &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; Co");
    expect(html).not.toContain("<script>alert('x')</script>");
  });

  it("is deterministic", () => {
    expect(renderProposalHtml(tritenProposal())).toBe(renderProposalHtml(tritenProposal()));
  });
});
