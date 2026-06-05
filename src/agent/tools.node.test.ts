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
    const setProjectInputs = tools.get("set_project_inputs");
    expect(setProjectInputs).toBeDefined();

    const result = await run(setProjectInputs!, projectInputs);
    const project = session.store.current.project;
    expect(project.cost.workstreams).toHaveLength(2);
    expect(project.pricing.tiers[0]?.price).toBe(40000);
    expect(session.store.current.pricing.phases[0]?.name).toBe("Pilot Build");
    expect(snapshot(result).draft.phases[0]?.price).toBe(40000);
  });

  it("patch_prepared_for and patch_details mutate the right slices", async () => {
    const session = newSession();
    const tools = toolMap(session);

    await run(tools.get("patch_prepared_for")!, {
      companyName: "Acme Operations",
      buyerName: "Riley Chen",
    });
    await run(tools.get("patch_details")!, {
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
    await run(toolMap(sessionA).get("set_project_inputs")!, projectInputs);
    await run(toolMap(sessionB).get("set_project_inputs")!, projectInputs);

    const resultA = await run(toolMap(sessionA).get("run_analysis")!, {});
    const resultB = await run(toolMap(sessionB).get("run_analysis")!, {});

    expect(resultA.content).toEqual(resultB.content);
    expect(snapshot(resultA).economics?.leadPrice).toBe(40000);
    expect(snapshot(resultA).economics?.paybackMonths).toBe(
      snapshot(resultB).economics?.paybackMonths,
    );
  });

  it("run_analysis refuses before workstreams are set", async () => {
    const session = newSession();
    const result = await run(toolMap(session).get("run_analysis")!, {});
    expect(result.content).toContain("no cost workstreams");
    expect(snapshot(result).economics).toBeNull();
  });

  it("validate_draft reports issues until the draft is complete", async () => {
    const session = newSession();
    const tools = toolMap(session);

    const before = await run(tools.get("validate_draft")!, {});
    expect(snapshot(before).validation.ok).toBe(false);

    await run(tools.get("set_project_inputs")!, projectInputs);
    await run(tools.get("patch_prepared_for")!, { companyName: "Acme Operations" });
    const after = await run(tools.get("validate_draft")!, {});
    expect(snapshot(after).validation).toBeDefined();
  });
});
