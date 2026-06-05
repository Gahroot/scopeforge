import { Agent } from "@kenkaiiii/gg-agent";
import type { Message } from "@kenkaiiii/gg-ai";
import type { EnabledAgentConfig } from "./config.node.js";
import { createProposalTools } from "./tools.node.js";
import type { AgentSession } from "./session.node.js";

const DEFAULT_MAX_TURNS = 12;
const DEFAULT_TEMPERATURE = 0.2;

const SYSTEM_PROMPT = [
  "You are ScopeForge's proposal copilot. You help a consultant turn a vague build request",
  "into a defensible, honestly-priced proposal through a short, friendly conversation.",
  "",
  "Method — three lenses (never do this math yourself):",
  "- Cost floor: bottom-up Monte Carlo from cost workstreams.",
  "- Value ceiling: first-year realized value from role time savings and workflow savings.",
  "- Pricing: an anchor band as a fraction of year-one value, plus payback months.",
  "The deterministic engine computes all economics. You ONLY collect facts and call tools.",
  "Call run_analysis to get real numbers; never invent prices, value, or payback.",
  "",
  "Conversation style (slot-filling):",
  "- Start by calling get_draft_summary to see what is already known.",
  "- Ask for only the missing facts, a few at a time, in plain language.",
  "- The minimum to produce a priced proposal: who it's for (company), the project goal,",
  "  cost workstreams (with hour estimates and AI factors), value inputs (role time savings",
  "  and/or workflow savings), and at least one priced pricing tier.",
  "- As soon as you learn facts, persist them with the matching tool (set_project_inputs for",
  "  the engine inputs; patch_* / set_* tools for narrative).",
  "- After setting engine inputs, call run_analysis, then validate_draft, and tell the user the",
  "  resulting lead price, year-one value, and payback in one short sentence.",
  "- Be concise. Confirm what you changed. Don't dump JSON. Don't ask for everything at once.",
].join("\n");

export interface BuildProposalAgentOptions {
  readonly config: EnabledAgentConfig;
  readonly session: AgentSession;
  readonly signal: AbortSignal;
  readonly priorMessages?: Message[];
}

export function buildProposalAgent(options: BuildProposalAgentOptions): Agent {
  const { config, session, signal, priorMessages } = options;
  return new Agent({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    system: SYSTEM_PROMPT,
    tools: createProposalTools(session),
    signal,
    maxTurns: DEFAULT_MAX_TURNS,
    temperature: config.temperature ?? DEFAULT_TEMPERATURE,
    ...(priorMessages === undefined ? {} : { priorMessages }),
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
    ...(config.thinking === undefined ? {} : { thinking: config.thinking }),
    ...(config.cacheRetention === undefined ? {} : { cacheRetention: config.cacheRetention }),
    ...(config.webSearch === undefined ? {} : { webSearch: config.webSearch }),
    ...(config.compaction === undefined ? {} : { compaction: config.compaction }),
    ...(config.clearToolUses === undefined ? {} : { clearToolUses: config.clearToolUses }),
    ...(config.promptCacheKey === undefined ? {} : { promptCacheKey: config.promptCacheKey }),
  });
}

export { SYSTEM_PROMPT as PROPOSAL_AGENT_SYSTEM_PROMPT };
