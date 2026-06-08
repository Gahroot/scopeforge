import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentConfigFromStore } from "./config.node.js";
import { AgentCredentialsStore } from "./credentials.node.js";

describe("AgentCredentialsStore", () => {
  it("stores API keys without exposing them in summaries", async () => {
    const filePath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "scopeforge-creds-")),
      "creds.json",
    );
    const store = new AgentCredentialsStore(filePath);
    const summary = await store.setApiKeyCredentials("openai", "sk-secret");
    expect(summary).toEqual({
      provider: "openai",
      configured: true,
      authKind: "api_key",
      expiresAt: expect.any(Number),
    });
    expect(JSON.stringify(summary)).not.toContain("sk-secret");
    await expect(store.resolveCredentials("openai")).resolves.toMatchObject({
      accessToken: "sk-secret",
    });
  });

  it("writes restrictive files where supported", async () => {
    const filePath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "scopeforge-creds-")),
      "creds.json",
    );
    const store = new AgentCredentialsStore(filePath);
    await store.setApiKeyCredentials("anthropic", "secret");
    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("stores OpenAI subscription credentials with account metadata", async () => {
    const filePath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "scopeforge-creds-")),
      "creds.json",
    );
    const store = new AgentCredentialsStore(filePath);
    await store.updateSettings({ provider: "openai", model: "gpt-5.5" });
    const summary = await store.setOAuthCredentials("openai", {
      accessToken: "oauth-access-token",
      refreshToken: "oauth-refresh-token",
      expiresAt: Date.now() + 60_000,
      accountId: "account-123",
      email: "operator@example.com",
    });

    expect(summary).toMatchObject({
      provider: "openai",
      configured: true,
      authKind: "oauth",
      accountId: "account-123",
      email: "operator@example.com",
    });
    await expect(loadAgentConfigFromStore(store)).resolves.toMatchObject({
      enabled: true,
      provider: "openai",
      model: "gpt-5.5",
      apiKey: "oauth-access-token",
      accountId: "account-123",
    });
  });

  it("normalizes legacy Anthropic Opus 4.8 model ids", async () => {
    const filePath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "scopeforge-creds-")),
      "creds.json",
    );
    await fs.writeFile(
      filePath,
      JSON.stringify({ settings: { provider: "anthropic", model: "opus-4.8" }, credentials: {} }),
    );
    const store = new AgentCredentialsStore(filePath);

    await expect(store.getSettings()).resolves.toMatchObject({ model: "claude-opus-4-8" });
    await expect(store.updateSettings({ model: "claude-opus-4.8" })).resolves.toMatchObject({
      model: "claude-opus-4-8",
    });
    await expect(fs.readFile(filePath, "utf-8")).resolves.toContain('"model": "claude-opus-4-8"');
  });
});
