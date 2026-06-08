import { describe, expect, it } from "vitest";
import type { AgentTool, StructuredToolResult, ToolContext } from "@kenkaiiii/gg-agent";
import type { SessionSnapshot } from "../ui/lib/types.js";
import { createSessionStore, type AgentSession } from "./session.node.js";
import { createProposalTools } from "./tools.node.js";

function newSession(): AgentSession {
  return createSessionStore({ idFactory: () => "test-session" }).create();
}

function toolMap(session: AgentSession): Map<string, AgentTool> {
  const map = new Map<string, AgentTool>();
  for (const tool of createProposalTools(session)) map.set(tool.name, tool);
  return map;
}

function requireTool(tools: Map<string, AgentTool>, name: string): AgentTool {
  const tool = tools.get(name);
  if (tool === undefined) throw new Error(`Tool not found: ${name}`);
  return tool;
}

const ctx: ToolContext = {
  signal: new AbortController().signal,
  toolCallId: "call-1",
};

async function run(tool: AgentTool, args: Record<string, unknown>): Promise<StructuredToolResult> {
  const result = await tool.execute(args, ctx);
  if (typeof result === "string") throw new Error("Expected a structured tool result.");
  return result;
}

function snapshot(result: StructuredToolResult): SessionSnapshot {
  return result.details as SessionSnapshot;
}

const projectInputs = {
  projectName: "Acme Ops Pilot",
  client: { sizeHeadcount: 45, buyerRole: "COO", workingWeeks: 46 },
  margin: 0.4,
  blendedRate: { optimistic: 120, likely: 150, pessimistic: 185 },
  workstreams: [
    {
      name: "Discovery + data model",
      hours: { optimistic: 18, likely: 28, pessimistic: 45 },
      aiFactor: 1,
      judgment: true,
    },
    {
      name: "Data layer",
      hours: { optimistic: 20, likely: 34, pessimistic: 55 },
      aiFactor: 0.55,
      judgment: false,
    },
  ],
  valueRealizationFactor: { low: 0.45, high: 0.55 },
  valueSegments: [{ role: "Analysts", headcount: 7, hoursPerWeek: 2.5, loadedRate: 75 }],
  valueWorkflows: [{ name: "Investor reporting", low: 5000, high: 15000 }],
  valueFraction: { low: 0.1, high: 0.2 },
  tiers: [{ name: "Pilot Build", price: 40000 }],
};

describe("proposal agent tools", () => {
  it("set_project_inputs writes workstreams and tiers onto the draft", async () => {
    const session = newSession();
    const tools = toolMap(session);

    const result = await run(requireTool(tools, "set_project_inputs"), projectInputs);
    const project = session.store.current.project;
    expect(project.cost.workstreams).toHaveLength(2);
    expect(project.pricing.tiers[0]?.price).toBe(40000);
    expect(session.store.current.pricing.phases[0]?.name).toBe("Pilot Build");
    expect(snapshot(result).draft.phases[0]?.price).toBe(40000);
  });

  it("patch_prepared_for and patch_details mutate the right slices", async () => {
    const session = newSession();
    const tools = toolMap(session);

    await run(requireTool(tools, "patch_prepared_for"), {
      companyName: "Acme Operations",
      buyerName: "Riley Chen",
    });
    await run(requireTool(tools, "patch_details"), {
      title: "Operations AI Pilot",
      recommendation: "Start with a scoped pilot.",
    });

    expect(session.store.current.preparedFor.companyName).toBe("Acme Operations");
    expect(session.store.current.preparedFor.buyerName).toBe("Riley Chen");
    expect(session.store.current.details.title).toBe("Operations AI Pilot");
  });

  it("run_analysis is deterministic for identical inputs", async () => {
    const sessionA = newSession();
    const sessionB = newSession();
    const toolsA = toolMap(sessionA);
    const toolsB = toolMap(sessionB);
    await run(requireTool(toolsA, "set_project_inputs"), projectInputs);
    await run(requireTool(toolsB, "set_project_inputs"), projectInputs);

    const resultA = await run(requireTool(toolsA, "run_analysis"), {});
    const resultB = await run(requireTool(toolsB, "run_analysis"), {});

    expect(resultA.content).toEqual(resultB.content);
    expect(snapshot(resultA).economics?.leadPrice).toBe(40000);
    expect(snapshot(resultA).economics?.paybackMonths).toBe(
      snapshot(resultB).economics?.paybackMonths,
    );
  });

  it("run_analysis refuses before workstreams are set", async () => {
    const session = newSession();
    const result = await run(requireTool(toolMap(session), "run_analysis"), {});
    expect(result.content).toContain("no cost workstreams");
    expect(snapshot(result).economics).toBeNull();
  });

  it("ingest_source_material applies observed fields without inventing workstreams", async () => {
    const session = newSession();
    const result = await run(requireTool(toolMap(session), "ingest_source_material"), {
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
  });

  it("validate_draft reports issues until the draft is complete", async () => {
    const session = newSession();
    const tools = toolMap(session);

    const before = await run(requireTool(tools, "validate_draft"), {});
    expect(snapshot(before).validation.ok).toBe(false);

    await run(requireTool(tools, "set_project_inputs"), projectInputs);
    await run(requireTool(tools, "patch_prepared_for"), { companyName: "Acme Operations" });
    const after = await run(requireTool(tools, "validate_draft"), {});
    expect(snapshot(after).validation).toBeDefined();
  });
});
