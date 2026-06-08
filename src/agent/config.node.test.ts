import {
  AgentConfigError,
  DEFAULT_AGENT_TEMPERATURE,
  agentConfigToStreamDefaults,
  loadAgentConfigFromEnv,
  readAgentConfigFromEnv,
  resolveAgentTemperature,
  summarizeAgentConfig,
  type AgentConfigEnv,
} from "./config.node.js";

const secret = "sk-scopeforge-test-secret";

describe("agent config", () => {
  it("stays disabled when no scoped agent env vars are present", () => {
    const result = loadAgentConfigFromEnv({ OPENAI_API_KEY: secret });

    expect(result).toEqual({ ok: true, value: { enabled: false, reason: "not_configured" } });
  });

  it("loads a complete local gg-ai provider configuration", () => {
    const config = readAgentConfigFromEnv({
      SCOPEFORGE_AGENT_ENABLED: "true",
      SCOPEFORGE_AGENT_PROVIDER: "anthropic",
      SCOPEFORGE_AGENT_MODEL: "claude-sonnet-4-6",
      SCOPEFORGE_AGENT_API_KEY: ` ${secret} `,
      SCOPEFORGE_AGENT_BASE_URL: "https://api.anthropic.com/",
      SCOPEFORGE_AGENT_MAX_TOKENS: "4096",
      SCOPEFORGE_AGENT_TEMPERATURE: "0.2",
      SCOPEFORGE_AGENT_TOP_P: "0.9",
      SCOPEFORGE_AGENT_THINKING: "medium",
      SCOPEFORGE_AGENT_CACHE_RETENTION: "short",
      SCOPEFORGE_AGENT_WEB_SEARCH: "yes",
      SCOPEFORGE_AGENT_COMPACTION: "off",
      SCOPEFORGE_AGENT_CLEAR_TOOL_USES: "1",
      SCOPEFORGE_AGENT_PROMPT_CACHE_KEY: "scopeforge-local",
    });

    expect(config).toEqual({
      enabled: true,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: secret,
      apiKeyEnvVar: "SCOPEFORGE_AGENT_API_KEY",
      baseUrl: "https://api.anthropic.com/",
      maxTokens: 4096,
      temperature: 0.2,
      topP: 0.9,
      thinking: "medium",
      cacheRetention: "short",
      webSearch: true,
      compaction: false,
      clearToolUses: true,
      promptCacheKey: "scopeforge-local",
    });
    if (!config.enabled) throw new Error("Expected enabled agent config.");

    expect(agentConfigToStreamDefaults(config)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: secret,
      baseUrl: "https://api.anthropic.com/",
      maxTokens: 4096,
      temperature: 0.2,
      topP: 0.9,
      thinking: "medium",
      cacheRetention: "short",
      webSearch: true,
      compaction: false,
      clearToolUses: true,
      promptCacheKey: "scopeforge-local",
    });
  });

  it("omits temperature for Anthropic Opus 4.8 while keeping it for Kimi", () => {
    const anthropic = readAgentConfigFromEnv({
      SCOPEFORGE_AGENT_PROVIDER: "anthropic",
      SCOPEFORGE_AGENT_MODEL: "claude-opus-4-8",
      SCOPEFORGE_AGENT_API_KEY: secret,
      SCOPEFORGE_AGENT_TEMPERATURE: "0.2",
    });
    if (!anthropic.enabled) throw new Error("Expected enabled Anthropic config.");

    expect(resolveAgentTemperature(anthropic, DEFAULT_AGENT_TEMPERATURE)).toBeUndefined();
    expect(
      resolveAgentTemperature(
        { provider: "anthropic", model: "claude-opus-4.8", temperature: 0.2 },
        DEFAULT_AGENT_TEMPERATURE,
      ),
    ).toBeUndefined();
    expect(agentConfigToStreamDefaults(anthropic)).not.toHaveProperty("temperature");

    const kimi = readAgentConfigFromEnv({
      SCOPEFORGE_AGENT_PROVIDER: "moonshot",
      SCOPEFORGE_AGENT_MODEL: "kimi-k2.6",
      SCOPEFORGE_AGENT_API_KEY: secret,
      SCOPEFORGE_AGENT_TEMPERATURE: "0.2",
    });
    if (!kimi.enabled) throw new Error("Expected enabled Kimi config.");

    expect(resolveAgentTemperature(kimi, DEFAULT_AGENT_TEMPERATURE)).toBe(0.2);
    expect(
      resolveAgentTemperature(
        { provider: "moonshot", model: "kimi-k2.6" },
        DEFAULT_AGENT_TEMPERATURE,
      ),
    ).toBe(0.2);
    expect(agentConfigToStreamDefaults(kimi)).toMatchObject({ temperature: 0.2 });
  });

  it("uses provider-specific key env vars without exposing their values in summaries", () => {
    const config = readAgentConfigFromEnv({
      SCOPEFORGE_AGENT_PROVIDER: "openai",
      SCOPEFORGE_AGENT_MODEL: "gpt-4.1",
      OPENAI_API_KEY: secret,
    });

    const summary = summarizeAgentConfig(config);
    const serialized = JSON.stringify(summary);

    expect(summary).toEqual({
      enabled: true,
      provider: "openai",
      model: "gpt-4.1",
      hasApiKey: true,
      apiKeyEnvVar: "OPENAI_API_KEY",
    });
    expect(serialized).not.toContain(secret);
  });

  it("rejects partial or invalid startup configuration", () => {
    const result = loadAgentConfigFromEnv({
      SCOPEFORGE_AGENT_ENABLED: "true",
      SCOPEFORGE_AGENT_PROVIDER: "ollama",
      SCOPEFORGE_AGENT_MAX_TOKENS: "0",
      SCOPEFORGE_AGENT_WEB_SEARCH: "maybe",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invalid config to fail.");
    expect(result.errors.map((error) => error.key)).toEqual([
      "SCOPEFORGE_AGENT_PROVIDER",
      "SCOPEFORGE_AGENT_MODEL",
      "SCOPEFORGE_AGENT_MAX_TOKENS",
      "SCOPEFORGE_AGENT_WEB_SEARCH",
    ]);
  });

  it("throws startup-safe error messages that mention env names, not secret values", () => {
    const input = {
      SCOPEFORGE_AGENT_PROVIDER: "gemini",
      SCOPEFORGE_AGENT_MODEL: "gemini-2.5-pro",
      SCOPEFORGE_AGENT_API_KEY: secret,
      SCOPEFORGE_AGENT_BASE_URL: "file:///tmp/not-http",
    } satisfies AgentConfigEnv;

    expect(() => readAgentConfigFromEnv(input)).toThrow(AgentConfigError);
    expect(() => readAgentConfigFromEnv(input)).toThrow("SCOPEFORGE_AGENT_BASE_URL");
    expect(() => readAgentConfigFromEnv(input)).not.toThrow(secret);
  });
});
