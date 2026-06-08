import { describe, expect, it } from "vitest";
import { PROPOSAL_AGENT_SYSTEM_PROMPT } from "./proposalAgent.node.js";

describe("proposal agent system prompt", () => {
  it("instructs the model to trust structured project state over stale chat", () => {
    expect(PROPOSAL_AGENT_SYSTEM_PROMPT).toContain(
      "Always rely on the structured draft and brand state",
    );
    expect(PROPOSAL_AGENT_SYSTEM_PROMPT).toContain("trust the structured project state");
  });
});
