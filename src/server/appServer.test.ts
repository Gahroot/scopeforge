import { AgentConfigError } from "../agent/config.node.js";
import { startAppServer } from "./appServer.js";

describe("app server agent startup config", () => {
  it("validates agent config before listening", async () => {
    await expect(
      startAppServer({
        port: 0,
        agentEnv: { SCOPEFORGE_AGENT_ENABLED: "true" },
      }),
    ).rejects.toThrow(AgentConfigError);
  });

  it("returns only a safe agent summary when startup config is valid", async () => {
    const secret = "sk-server-test-secret";
    const server = await startAppServer({
      port: 0,
      agentEnv: {
        SCOPEFORGE_AGENT_PROVIDER: "openai",
        SCOPEFORGE_AGENT_MODEL: "gpt-4.1",
        SCOPEFORGE_AGENT_API_KEY: secret,
      },
    });

    try {
      const serialized = JSON.stringify(server.agent);
      expect(server.agent).toEqual({
        enabled: true,
        provider: "openai",
        model: "gpt-4.1",
        hasApiKey: true,
        apiKeyEnvVar: "SCOPEFORGE_AGENT_API_KEY",
      });
      expect(serialized).not.toContain(secret);
    } finally {
      await server.close();
    }
  });
});
