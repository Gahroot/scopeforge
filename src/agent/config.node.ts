import { env as nodeEnv } from "node:process";
import type { CacheRetention, Provider, StreamOptions, ThinkingLevel } from "@kenkaiiii/gg-ai";

export const AGENT_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "gemini",
  "glm",
  "moonshot",
  "deepseek",
  "openrouter",
  "minimax",
  "xiaomi",
] as const satisfies readonly Provider[];

export const AGENT_THINKING_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingLevel[];

export const AGENT_CACHE_RETENTIONS = [
  "none",
  "short",
  "long",
] as const satisfies readonly CacheRetention[];

export const AGENT_SCOPED_ENV_KEYS = [
  "SCOPEFORGE_AGENT_ENABLED",
  "SCOPEFORGE_AGENT_PROVIDER",
  "SCOPEFORGE_AGENT_MODEL",
  "SCOPEFORGE_AGENT_API_KEY",
  "SCOPEFORGE_AGENT_BASE_URL",
  "SCOPEFORGE_AGENT_MAX_TOKENS",
  "SCOPEFORGE_AGENT_TEMPERATURE",
  "SCOPEFORGE_AGENT_TOP_P",
  "SCOPEFORGE_AGENT_THINKING",
  "SCOPEFORGE_AGENT_CACHE_RETENTION",
  "SCOPEFORGE_AGENT_WEB_SEARCH",
  "SCOPEFORGE_AGENT_COMPACTION",
  "SCOPEFORGE_AGENT_CLEAR_TOOL_USES",
  "SCOPEFORGE_AGENT_PROMPT_CACHE_KEY",
] as const;

export type AgentProvider = (typeof AGENT_PROVIDER_IDS)[number];
export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number];
export type AgentCacheRetention = (typeof AGENT_CACHE_RETENTIONS)[number];
export type AgentConfigEnv = Readonly<Record<string, string | undefined>>;
export type DisabledAgentConfigReason = "not_configured" | "disabled_by_env";

export interface DisabledAgentConfig {
  readonly enabled: false;
  readonly reason: DisabledAgentConfigReason;
}

export interface EnabledAgentConfig {
  readonly enabled: true;
  readonly provider: AgentProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly apiKeyEnvVar: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly thinking?: AgentThinkingLevel;
  readonly cacheRetention?: AgentCacheRetention;
  readonly webSearch?: boolean;
  readonly compaction?: boolean;
  readonly clearToolUses?: boolean;
  readonly promptCacheKey?: string;
}

export type AgentConfig = DisabledAgentConfig | EnabledAgentConfig;

export interface AgentConfigValidationError {
  readonly key: string;
  readonly message: string;
}

export type AgentConfigResult =
  | { readonly ok: true; readonly value: AgentConfig }
  | { readonly ok: false; readonly errors: readonly AgentConfigValidationError[] };

export interface AgentConfigSummary {
  readonly enabled: boolean;
  readonly reason?: DisabledAgentConfigReason;
  readonly provider?: AgentProvider;
  readonly model?: string;
  readonly hasApiKey?: boolean;
  readonly apiKeyEnvVar?: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly thinking?: AgentThinkingLevel;
  readonly cacheRetention?: AgentCacheRetention;
  readonly webSearch?: boolean;
  readonly compaction?: boolean;
  readonly clearToolUses?: boolean;
  readonly promptCacheKey?: string;
}

export type AgentStreamDefaults = Pick<
  StreamOptions,
  | "provider"
  | "model"
  | "apiKey"
  | "baseUrl"
  | "maxTokens"
  | "temperature"
  | "topP"
  | "thinking"
  | "cacheRetention"
  | "webSearch"
  | "compaction"
  | "clearToolUses"
  | "promptCacheKey"
>;

const PROVIDER_API_KEY_ENV_KEYS = {
  anthropic: ["SCOPEFORGE_AGENT_API_KEY", "ANTHROPIC_API_KEY"],
  openai: ["SCOPEFORGE_AGENT_API_KEY", "OPENAI_API_KEY"],
  gemini: ["SCOPEFORGE_AGENT_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  glm: ["SCOPEFORGE_AGENT_API_KEY", "GLM_API_KEY", "ZAI_API_KEY", "Z_AI_API_KEY"],
  moonshot: ["SCOPEFORGE_AGENT_API_KEY", "MOONSHOT_API_KEY", "KIMI_API_KEY"],
  deepseek: ["SCOPEFORGE_AGENT_API_KEY", "DEEPSEEK_API_KEY"],
  openrouter: ["SCOPEFORGE_AGENT_API_KEY", "OPENROUTER_API_KEY"],
  minimax: ["SCOPEFORGE_AGENT_API_KEY", "MINIMAX_API_KEY"],
  xiaomi: ["SCOPEFORGE_AGENT_API_KEY", "XIAOMI_API_KEY"],
} as const satisfies Record<AgentProvider, readonly string[]>;

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export class AgentConfigError extends Error {
  readonly errors: readonly AgentConfigValidationError[];

  constructor(errors: readonly AgentConfigValidationError[]) {
    super(formatAgentConfigErrors(errors));
    this.name = "AgentConfigError";
    this.errors = errors;
  }
}

export function loadAgentConfigFromEnv(input: AgentConfigEnv = nodeEnv): AgentConfigResult {
  const errors: AgentConfigValidationError[] = [];
  const enabled = readOptionalBoolean(input, "SCOPEFORGE_AGENT_ENABLED", errors);
  const hasScopedConfig = hasScopedAgentConfig(input);

  if (errors.length > 0) return { ok: false, errors };
  if (enabled === false) return { ok: true, value: { enabled: false, reason: "disabled_by_env" } };
  if (enabled !== true && !hasScopedConfig) {
    return { ok: true, value: { enabled: false, reason: "not_configured" } };
  }

  const provider = readProvider(input, errors);
  const model = readRequiredString(input, "SCOPEFORGE_AGENT_MODEL", errors);
  const apiKeyResult = provider === undefined ? undefined : readApiKey(input, provider, errors);
  const baseUrl = readOptionalBaseUrl(input, "SCOPEFORGE_AGENT_BASE_URL", errors);
  const maxTokens = readOptionalInteger(input, "SCOPEFORGE_AGENT_MAX_TOKENS", 1, 1_000_000, errors);
  const temperature = readOptionalNumber(input, "SCOPEFORGE_AGENT_TEMPERATURE", 0, 2, errors);
  const topP = readOptionalNumber(input, "SCOPEFORGE_AGENT_TOP_P", 0, 1, errors);
  const thinking = readOptionalChoice(
    input,
    "SCOPEFORGE_AGENT_THINKING",
    AGENT_THINKING_LEVELS,
    errors,
  );
  const cacheRetention = readOptionalChoice(
    input,
    "SCOPEFORGE_AGENT_CACHE_RETENTION",
    AGENT_CACHE_RETENTIONS,
    errors,
  );
  const webSearch = readOptionalBoolean(input, "SCOPEFORGE_AGENT_WEB_SEARCH", errors);
  const compaction = readOptionalBoolean(input, "SCOPEFORGE_AGENT_COMPACTION", errors);
  const clearToolUses = readOptionalBoolean(input, "SCOPEFORGE_AGENT_CLEAR_TOOL_USES", errors);
  const promptCacheKey = readOptionalString(input, "SCOPEFORGE_AGENT_PROMPT_CACHE_KEY");

  if (errors.length > 0) return { ok: false, errors };
  if (provider === undefined || model === undefined || apiKeyResult === undefined) {
    return {
      ok: false,
      errors: [
        {
          key: "SCOPEFORGE_AGENT_PROVIDER",
          message: "Agent provider, model, and API key are required when agent config is enabled.",
        },
      ],
    };
  }

  return {
    ok: true,
    value: {
      enabled: true,
      provider,
      model,
      apiKey: apiKeyResult.value,
      apiKeyEnvVar: apiKeyResult.envVar,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
      ...(thinking === undefined ? {} : { thinking }),
      ...(cacheRetention === undefined ? {} : { cacheRetention }),
      ...(webSearch === undefined ? {} : { webSearch }),
      ...(compaction === undefined ? {} : { compaction }),
      ...(clearToolUses === undefined ? {} : { clearToolUses }),
      ...(promptCacheKey === undefined ? {} : { promptCacheKey }),
    },
  };
}

export function readAgentConfigFromEnv(input: AgentConfigEnv = nodeEnv): AgentConfig {
  const result = loadAgentConfigFromEnv(input);
  if (!result.ok) throw new AgentConfigError(result.errors);
  return result.value;
}

export function agentConfigToStreamDefaults(config: EnabledAgentConfig): AgentStreamDefaults {
  return {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.topP === undefined ? {} : { topP: config.topP }),
    ...(config.thinking === undefined ? {} : { thinking: config.thinking }),
    ...(config.cacheRetention === undefined ? {} : { cacheRetention: config.cacheRetention }),
    ...(config.webSearch === undefined ? {} : { webSearch: config.webSearch }),
    ...(config.compaction === undefined ? {} : { compaction: config.compaction }),
    ...(config.clearToolUses === undefined ? {} : { clearToolUses: config.clearToolUses }),
    ...(config.promptCacheKey === undefined ? {} : { promptCacheKey: config.promptCacheKey }),
  };
}

export function summarizeAgentConfig(config: AgentConfig): AgentConfigSummary {
  if (!config.enabled) {
    return { enabled: false, reason: config.reason };
  }

  return {
    enabled: true,
    provider: config.provider,
    model: config.model,
    hasApiKey: config.apiKey.length > 0,
    apiKeyEnvVar: config.apiKeyEnvVar,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    ...(config.maxTokens === undefined ? {} : { maxTokens: config.maxTokens }),
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.topP === undefined ? {} : { topP: config.topP }),
    ...(config.thinking === undefined ? {} : { thinking: config.thinking }),
    ...(config.cacheRetention === undefined ? {} : { cacheRetention: config.cacheRetention }),
    ...(config.webSearch === undefined ? {} : { webSearch: config.webSearch }),
    ...(config.compaction === undefined ? {} : { compaction: config.compaction }),
    ...(config.clearToolUses === undefined ? {} : { clearToolUses: config.clearToolUses }),
    ...(config.promptCacheKey === undefined ? {} : { promptCacheKey: config.promptCacheKey }),
  };
}

export function formatAgentConfigErrors(errors: readonly AgentConfigValidationError[]): string {
  return [
    "Invalid ScopeForge agent LLM configuration.",
    ...errors.map((error) => `- ${error.key}: ${error.message}`),
  ].join("\n");
}

export function isAgentProvider(input: string): input is AgentProvider {
  return AGENT_PROVIDER_IDS.some((provider) => provider === input);
}

function hasScopedAgentConfig(input: AgentConfigEnv): boolean {
  return AGENT_SCOPED_ENV_KEYS.some((key) => {
    if (key === "SCOPEFORGE_AGENT_ENABLED") return false;
    return readOptionalString(input, key) !== undefined;
  });
}

function readProvider(
  input: AgentConfigEnv,
  errors: AgentConfigValidationError[],
): AgentProvider | undefined {
  const value = readRequiredString(input, "SCOPEFORGE_AGENT_PROVIDER", errors);
  if (value === undefined) return undefined;
  if (isAgentProvider(value)) return value;

  errors.push({
    key: "SCOPEFORGE_AGENT_PROVIDER",
    message: `Must be one of: ${AGENT_PROVIDER_IDS.join(", ")}.`,
  });
  return undefined;
}

function readApiKey(
  input: AgentConfigEnv,
  provider: AgentProvider,
  errors: AgentConfigValidationError[],
): { readonly value: string; readonly envVar: string } | undefined {
  const keys = PROVIDER_API_KEY_ENV_KEYS[provider];
  for (const key of keys) {
    const value = readOptionalString(input, key);
    if (value !== undefined) return { value, envVar: key };
  }

  errors.push({
    key: keys.join(" or "),
    message: `Set one API key env var for provider ${provider}. Prefer SCOPEFORGE_AGENT_API_KEY for local-only agent config.`,
  });
  return undefined;
}

function readRequiredString(
  input: AgentConfigEnv,
  key: string,
  errors: AgentConfigValidationError[],
): string | undefined {
  const value = readOptionalString(input, key);
  if (value !== undefined) return value;

  errors.push({ key, message: "Must be a non-empty string." });
  return undefined;
}

function readOptionalString(input: AgentConfigEnv, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readOptionalBoolean(
  input: AgentConfigEnv,
  key: string,
  errors: AgentConfigValidationError[],
): boolean | undefined {
  const value = readOptionalString(input, key);
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;

  errors.push({ key, message: "Must be a boolean: true/false, yes/no, on/off, or 1/0." });
  return undefined;
}

function readOptionalInteger(
  input: AgentConfigEnv,
  key: string,
  min: number,
  max: number,
  errors: AgentConfigValidationError[],
): number | undefined {
  const value = readOptionalString(input, key);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    errors.push({ key, message: `Must be an integer from ${min} to ${max}.` });
    return undefined;
  }
  return number;
}

function readOptionalNumber(
  input: AgentConfigEnv,
  key: string,
  min: number,
  max: number,
  errors: AgentConfigValidationError[],
): number | undefined {
  const value = readOptionalString(input, key);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    errors.push({ key, message: `Must be a number from ${min} to ${max}.` });
    return undefined;
  }
  return number;
}

function readOptionalChoice<T extends string>(
  input: AgentConfigEnv,
  key: string,
  choices: readonly T[],
  errors: AgentConfigValidationError[],
): T | undefined {
  const value = readOptionalString(input, key);
  if (value === undefined) return undefined;
  const match = choices.find((choice) => choice === value);
  if (match !== undefined) return match;

  errors.push({ key, message: `Must be one of: ${choices.join(", ")}.` });
  return undefined;
}

function readOptionalBaseUrl(
  input: AgentConfigEnv,
  key: string,
  errors: AgentConfigValidationError[],
): string | undefined {
  const value = readOptionalString(input, key);
  if (value === undefined) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    errors.push({ key, message: "Must be a valid http(s) URL." });
    return undefined;
  }

  errors.push({ key, message: "Must use http or https." });
  return undefined;
}
