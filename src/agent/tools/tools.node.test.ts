import { describe, expect, it } from "vitest";
import type { AgentTool, StructuredToolResult, ToolContext } from "@kenkaiiii/gg-agent";
import { tritenExample } from "../../data/defaults.js";
import { createProposalDraftStore, proposalIntakeToDraft } from "../../proposal/draftStore.js";
import { validateProposalDraft as validateDraftSchema } from "../../proposal/schema.js";
import type { ProposalIntake } from "../../proposal/types.js";
import type { SessionSnapshot } from "../../ui/lib/types.js";
import { createSessionStore, type AgentSession } from "../session.node.js";
import { createScopeForgeTools, type PdfRenderer } from "./index.js";

const ctx: ToolContext = { signal: new AbortController().signal, toolCallId: "call-1" };

const FIXED_NOW = new Date("2025-03-01T00:00:00.000Z");

/** A complete intake so the seeded draft validates and the engine has real inputs. */
function tritenIntake(): ProposalIntake {
  return {
    project: tritenExample(),
    preparedFor: { companyName: "Triten Real Estate Partners", buyerName: "Sam Rivera" },
    details: {
      title: "Operations AI Pilot",
      recommendation: "Start with a scoped pilot that pays back inside the first year.",
      executiveSummary: ["A bottom-up build with a defensible price and clear payback."],
      whatWeHeard: ["Reporting and underwriting eat analyst time every week."],
    },
    scope: [
      {
        title: "Unified data layer",
        description: "Ingest Power BI + Monday into one model.",
        deliverables: ["Connectors", "Canonical schema"],
      },
      {
        title: "AI Q&A over operations",
        description: "An MCP server answering operational questions.",
        deliverables: ["MCP server", "Q&A endpoint"],
      },
    ],
    milestones: [{ name: "Discovery", timing: "Weeks 1-2", outcomes: ["Agreed data model"] }],
    assumptions: ["Client provides data access in week 1."],
    exclusions: ["Net-new data warehouse migration."],
    clientInputs: ["A data owner for Power BI and Monday."],
    nextSteps: ["Countersign and schedule the kickoff."],
  };
}

function seededSession(): AgentSession {
  const session = createSessionStore({ idFactory: () => "tool-test" }).create();
  session.store = createProposalDraftStore(proposalIntakeToDraft(tritenIntake()), {
    label: "Seed triten",
  });
  return session;
}

function emptySession(): AgentSession {
  return createSessionStore({ idFactory: () => "empty-test" }).create();
}

function toolset(session: AgentSession, renderPdf?: PdfRenderer): Map<string, AgentTool> {
  const map = new Map<string, AgentTool>();
  for (const tool of createScopeForgeTools({
    session,
    now: () => FIXED_NOW,
    ...(renderPdf === undefined ? {} : { renderPdf }),
  })) {
    map.set(tool.name, tool);
  }
  return map;
}

async function run(
  tools: Map<string, AgentTool>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<StructuredToolResult> {
  const tool = tools.get(name);
  if (tool === undefined) throw new Error(`Tool not found: ${name}`);
  const result = await tool.execute(args, ctx);
  if (typeof result === "string") throw new Error("Expected a structured tool result.");
  return result;
}

function snapshot(result: StructuredToolResult): SessionSnapshot {
  return result.details as SessionSnapshot;
}

describe("createScopeForgeTools", () => {
  it("exposes exactly the required named tools", () => {
    const names = createScopeForgeTools({ session: emptySession() }).map((t) => t.name);
    expect(new Set(names)).toEqual(
      new Set([
        "read_current_draft",
        "update_proposal_draft",
        "validate_proposal_draft",
        "analyze_project",
        "explain_guardrails",
        "render_proposal_preview",
        "render_proposal_pdf",
        "ask_for_missing_inputs",
        "ingest_source_material",
        "switch_template",
        "apply_brand",
        "revise_section_copy",
        "generate_value_table_from_inputs",
        "generate_phase_plan_from_scope",
      ]),
    );
  });
});

describe("read_current_draft", () => {
  it("returns a summary and the full draft without mutating", () => {
    const session = seededSession();
    const versionBefore = session.store.currentVersion;
    const result = run(toolset(session), "read_current_draft");
    return result.then((r) => {
      expect(r.content).toContain("Triten Real Estate Partners");
      expect(snapshot(r).fullDraft).toBeDefined();
      expect(session.store.currentVersion).toBe(versionBefore);
    });
  });
});

describe("update_proposal_draft", () => {
  it("patches only the provided slices", async () => {
    const session = seededSession();
    const tools = toolset(session);
    await run(tools, "update_proposal_draft", {
      preparedFor: { buyerTitle: "COO" },
      details: { title: "Operations AI — Pilot" },
      nextSteps: ["Sign", "Kick off"],
    });
    expect(session.store.current.preparedFor.buyerTitle).toBe("COO");
    expect(session.store.current.details.title).toBe("Operations AI — Pilot");
    expect(session.store.current.nextSteps).toEqual(["Sign", "Kick off"]);
  });

  it("reports when no fields are provided", async () => {
    const session = seededSession();
    const result = await run(toolset(session), "update_proposal_draft", {});
    expect(result.content).toContain("unchanged");
  });
});

describe("validate_proposal_draft", () => {
  it("passes for a complete seeded draft and fails for an empty one", async () => {
    expect((await run(toolset(seededSession()), "validate_proposal_draft")).content).toContain(
      "valid",
    );
    const empty = await run(toolset(emptySession()), "validate_proposal_draft");
    expect(empty.content).toContain("not valid");
  });
});

describe("analyze_project", () => {
  it("is deterministic across sessions for identical inputs", async () => {
    const a = await run(toolset(seededSession()), "analyze_project");
    const b = await run(toolset(seededSession()), "analyze_project");
    expect(a.content).toEqual(b.content);
    expect(a.content).toContain("Lead price: $40,000");
    expect(snapshot(a).economics?.leadPrice).toBe(40000);
  });

  it("refuses before workstreams exist", async () => {
    const result = await run(toolset(emptySession()), "analyze_project");
    expect(result.content).toContain("no cost workstreams");
  });
});

describe("explain_guardrails", () => {
  it("explains triggered guardrails or reports a clean bill", async () => {
    const result = await run(toolset(seededSession()), "explain_guardrails");
    expect(typeof result.content).toBe("string");
  });

  it("refuses before workstreams exist", async () => {
    const result = await run(toolset(emptySession()), "explain_guardrails");
    expect(result.content).toContain("no cost workstreams");
  });
});

describe("render_proposal_preview", () => {
  it("renders deterministic brand-styled HTML", async () => {
    const first = await run(toolset(seededSession()), "render_proposal_preview");
    const second = await run(toolset(seededSession()), "render_proposal_preview");
    const html = (first.details as { html: string }).html;
    expect(html).toContain("<!doctype html>");
    expect((second.details as { html: string }).html).toEqual(html);
  });
});

describe("render_proposal_pdf", () => {
  it("uses the injected renderer and reports bytes", async () => {
    const session = seededSession();
    const calls: string[] = [];
    const fakeRenderer: PdfRenderer = async (options) => {
      calls.push(options.html);
      return { bytes: 2048, outputPath: options.outputPath ?? null, format: "Letter" };
    };
    const result = await run(toolset(session, fakeRenderer), "render_proposal_pdf", {
      outputPath: "out/test.pdf",
    });
    expect(calls).toHaveLength(1);
    expect(result.content).toContain("2048 bytes");
    expect(result.content).toContain("out/test.pdf");
  });

  it("refuses to export an invalid draft", async () => {
    const result = await run(toolset(emptySession()), "render_proposal_pdf");
    expect(result.content).toContain("not valid");
  });

  it("surfaces a missing-Chromium error as guidance", async () => {
    const failing: PdfRenderer = async () => {
      throw new Error("browser executable doesn't exist; run playwright install");
    };
    const result = await run(toolset(seededSession(), failing), "render_proposal_pdf");
    expect(result.content).toContain("playwright install chromium");
  });
});

describe("ask_for_missing_inputs", () => {
  it("lists questions for an empty draft and nothing for a complete one", async () => {
    const empty = await run(toolset(emptySession()), "ask_for_missing_inputs");
    expect(empty.content).toContain("Still needed");
    const complete = await run(toolset(seededSession()), "ask_for_missing_inputs");
    expect(complete.content).toContain("Nothing is missing");
  });
});

describe("ingest_source_material", () => {
  it("applies only safe observed fields and lists economic gaps", async () => {
    const session = emptySession();
    const result = await run(toolset(session), "ingest_source_material", {
      sourceKind: "meeting_notes",
      sourceName: "Discovery notes",
      applySafePatch: true,
      material: [
        "Client: Acme Operations",
        "Buyer: Riley Chen, COO",
        "Systems: Power BI, Monday",
        "Pain points: manual reconciliation",
        "Scope: reporting data layer",
        "Budget: $40k pilot",
      ].join("\n"),
    });

    expect(result.content).toContain("Applied safe observed fields");
    expect(result.content).toContain("Blended rate and target margin");
    expect(session.store.current.preparedFor.companyName).toBe("Acme Operations");
    expect(session.store.current.preparedFor.buyerTitle).toBe("COO");
    expect(session.store.current.project.cost.workstreams).toHaveLength(0);
    expect((result.details as { sourceMaterial?: unknown }).sourceMaterial).toBeDefined();
  });
});

describe("switch_template", () => {
  it("switches and reports a no-op when already active", async () => {
    const session = seededSession();
    const tools = toolset(session);
    const switched = await run(tools, "switch_template", { templateId: "generic/scope-review" });
    expect(switched.content).toContain("generic/scope-review");
    expect(session.store.current.templateIds[0]).toBe("generic/scope-review");
    const again = await run(tools, "switch_template", { templateId: "generic/scope-review" });
    expect(again.content).toContain("already");
  });
});

describe("apply_brand", () => {
  it("applies a built-in vendor brand", async () => {
    const session = seededSession();
    const result = await run(toolset(session), "apply_brand", { brandId: "partners" });
    expect(session.vendorBrand?.id).toBe("partners");
    expect(result.content).toContain("ScopeForge Partners");
  });

  it("seeds the client block when targeting the client", async () => {
    const session = seededSession();
    await run(toolset(session), "apply_brand", { brandId: "partners", target: "client" });
    expect(session.store.current.preparedFor.companyName).toBe("ScopeForge Partners");
  });

  it("rejects an unknown brand id", async () => {
    const result = await run(toolset(seededSession()), "apply_brand", { brandId: "nope" });
    expect(result.content).toContain("Unknown brandId");
  });
});

describe("revise_section_copy", () => {
  it("revises single-line and bulleted sections", async () => {
    const session = seededSession();
    const tools = toolset(session);
    await run(tools, "revise_section_copy", { section: "recommendation", text: "Pilot first." });
    await run(tools, "revise_section_copy", {
      section: "executiveSummary",
      items: ["Point one", "Point two"],
    });
    expect(session.store.current.details.recommendation).toBe("Pilot first.");
    expect(session.store.current.details.executiveSummary).toEqual(["Point one", "Point two"]);
  });

  it("rejects a list section given only text", async () => {
    const result = await run(toolset(seededSession()), "revise_section_copy", {
      section: "unlocks",
      text: "should be items",
    });
    expect(result.content).toContain("items");
  });
});

describe("generate_value_table_from_inputs", () => {
  it("builds rows that foot to the engine's year-one value", async () => {
    const session = seededSession();
    await run(toolset(session), "generate_value_table_from_inputs");
    const rows = session.store.current.valueProposal.valueSources;
    expect(rows.length).toBeGreaterThan(0);
    // Triten has 4 role segments + 3 workflows.
    expect(rows).toHaveLength(7);
    expect(session.store.current.valueProposal.annualValueTarget).toBeGreaterThan(0);
    expect(validateDraftSchema(session.store.current).ok).toBe(true);
  });
});

describe("generate_phase_plan_from_scope", () => {
  it("creates one sequenced phase per deliverable", async () => {
    const session = seededSession();
    await run(toolset(session), "generate_phase_plan_from_scope", { weeksPerPhase: 3 });
    const plan = session.store.current.buildPlan;
    expect(plan).toHaveLength(2);
    expect(plan[0]?.timing).toBe("Weeks 1-3");
    expect(plan[1]?.timing).toBe("Weeks 4-6");
    expect(validateDraftSchema(session.store.current).ok).toBe(true);
  });

  it("refuses when there are no deliverables", async () => {
    const result = await run(toolset(emptySession()), "generate_phase_plan_from_scope");
    expect(result.content).toContain("no deliverables");
  });
});
