import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  it("deduplicates concurrent OAuth refreshes into a single HTTP call", async () => {
    const filePath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "scopeforge-creds-")),
      "creds.json",
    );
    const store = new AgentCredentialsStore(filePath);
    await store.setOAuthCredentials("anthropic", {
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: Date.now() - 1_000,
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      }),
    );

    const [first, second] = await Promise.all([
      store.resolveCredentials("anthropic"),
      store.resolveCredentials("anthropic"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
    expect(second).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh" });
    fetchMock.mockRestore();
  });

  it("does not delete credentials replaced while a failing refresh was in flight", async () => {
    const filePath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "scopeforge-creds-")),
      "creds.json",
    );
    const store = new AgentCredentialsStore(filePath);
    await store.setOAuthCredentials("anthropic", {
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: Date.now() - 1_000,
    });

    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const pendingResolve = store.resolveCredentials("anthropic");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A concurrent flow (e.g. a fresh sign-in) stores newer credentials while
    // the refresh request is still in flight.
    await store.setOAuthCredentials("anthropic", {
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
      expiresAt: Date.now() + 3_600_000,
    });

    expect(resolveFetch).toBeDefined();
    resolveFetch?.(new Response("invalid_grant", { status: 400 }));

    await expect(pendingResolve).resolves.toMatchObject({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
    });
    await expect(store.summarizeCredentials("anthropic")).resolves.toMatchObject({
      configured: true,
      authKind: "oauth",
    });
    await expect(fs.readFile(filePath, "utf-8")).resolves.toContain("fresh-refresh");
    fetchMock.mockRestore();
  });

  it("deletes credentials when a refresh fails and no newer credentials exist", async () => {
    const filePath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "scopeforge-creds-")),
      "creds.json",
    );
    const store = new AgentCredentialsStore(filePath);
    await store.setOAuthCredentials("anthropic", {
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: Date.now() - 1_000,
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));

    await expect(store.resolveCredentials("anthropic")).resolves.toBeUndefined();
    await expect(store.summarizeCredentials("anthropic")).resolves.toMatchObject({
      configured: false,
    });
    fetchMock.mockRestore();
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
