import { afterEach, describe, expect, it } from "vitest";
import { Agent, type AgentEvent } from "@kenkaiiii/gg-agent";
import {
  palsuText,
  palsuToolCall,
  registerPalsuProvider,
  type PalsuProviderHandle,
} from "@kenkaiiii/gg-ai";
import { tritenExample } from "../../data/defaults.js";
import { createProposalDraftStore, proposalIntakeToDraft } from "../../proposal/draftStore.js";
import type { ProposalIntake } from "../../proposal/types.js";
import { createSessionStore, type AgentSession } from "../session.node.js";
import { createScopeForgeTools, type PdfRenderer } from "./index.js";

/**
 * These tests drive the real gg-agent loop against the `palsu` mock provider:
 * the fake model emits tool calls, the agent executes our tools, and we assert
 * the tools mutated the session draft and that the engine numbers flowed back.
 */

function tritenIntake(): ProposalIntake {
  return {
    project: tritenExample(),
    preparedFor: { companyName: "Triten Real Estate Partners" },
    details: {
      title: "Operations AI Pilot",
      recommendation: "Start with a scoped pilot.",
      executiveSummary: ["Defensible price with clear payback."],
      whatWeHeard: ["Reporting eats analyst time."],
    },
    scope: [
      {
        title: "Unified data layer",
        description: "Ingest sources into one model.",
        deliverables: ["Connectors"],
      },
    ],
    milestones: [{ name: "Discovery", timing: "Weeks 1-2", outcomes: ["Agreed model"] }],
    assumptions: ["Data access in week 1."],
    exclusions: ["Warehouse migration."],
    clientInputs: ["A data owner."],
    nextSteps: ["Countersign."],
  };
}

function seededSession(): AgentSession {
  const session = createSessionStore({ idFactory: () => "fake-provider" }).create();
  session.store = createProposalDraftStore(proposalIntakeToDraft(tritenIntake()), {
    label: "Seed",
  });
  return session;
}

const noopPdf: PdfRenderer = async (options) => ({
  bytes: 1024,
  outputPath: options.outputPath ?? null,
  format: "Letter",
});

let palsu: PalsuProviderHandle | null = null;

afterEach(() => {
  palsu?.unregister();
  palsu = null;
});

function buildAgent(session: AgentSession): Agent {
  return new Agent({
    provider: "palsu",
    model: "test",
    apiKey: "test-key",
    system: "You are a test harness.",
    tools: createScopeForgeTools({
      session,
      now: () => new Date("2025-01-01T00:00:00Z"),
      renderPdf: noopPdf,
    }),
    signal: new AbortController().signal,
    maxTurns: 6,
  });
}

async function collect(agent: Agent, prompt: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of agent.prompt(prompt)) events.push(event);
  return events;
}

describe("ScopeForge tools under a fake provider", () => {
  it("executes a tool call emitted by the mock model and mutates the draft", async () => {
    palsu = registerPalsuProvider();
    palsu.appendResponses(
      palsuToolCall("revise_section_copy", { section: "recommendation", text: "Pilot first." }),
      palsuText("Updated the recommendation."),
    );

    const session = seededSession();
    const events = await collect(buildAgent(session), "Revise the recommendation.");

    const toolCalls = events.filter((e) => e.type === "tool_call_start");
    expect(toolCalls).toHaveLength(1);
    expect(session.store.current.details.recommendation).toBe("Pilot first.");
  });

  it("runs a multi-tool plan: analyze then export, reading engine numbers back", async () => {
    palsu = registerPalsuProvider();
    palsu.appendResponses(
      palsuToolCall("analyze_project", {}),
      palsuToolCall("render_proposal_pdf", { outputPath: "out/fake.pdf" }),
      palsuText("Analyzed and exported."),
    );

    const session = seededSession();
    const events = await collect(buildAgent(session), "Analyze and export.");

    const toolEnds = events.filter((e) => e.type === "tool_call_end");
    expect(toolEnds.map((e) => (e.type === "tool_call_end" ? e.isError : true))).toEqual([
      false,
      false,
    ]);
    const analyzeEnd = events.find(
      (e) =>
        e.type === "tool_call_end" &&
        typeof e.result === "string" &&
        e.result.includes("Lead price"),
    );
    expect(analyzeEnd).toBeDefined();
    const exportEnd = events.find(
      (e) =>
        e.type === "tool_call_end" && typeof e.result === "string" && e.result.includes("bytes"),
    );
    expect(exportEnd).toBeDefined();
  });
});
