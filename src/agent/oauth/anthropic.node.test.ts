import { describe, expect, it, vi } from "vitest";
import { completeAnthropicOAuth, refreshAnthropicToken, startAnthropicOAuth } from "./anthropic.node.js";

describe("anthropic oauth", () => {
  it("builds a PKCE auth URL", async () => {
    const started = await startAnthropicOAuth(1_000);
    const url = new URL(started.authUrl);
    expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
    expect(url.searchParams.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
    expect(url.searchParams.get("scope")).toContain("user:inference");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(started.state);
  });

  it("rejects mismatched state", async () => {
    await expect(
      completeAnthropicOAuth({ code: "code", state: "wrong", expectedState: "right", verifier: "verifier" }),
    ).rejects.toThrow(/state mismatch/i);
  });

  it("falls back on 5xx but stops on 4xx", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(new Response("bad", { status: 502 }))
      .mockResolvedValueOnce(Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
    await expect(refreshAnthropicToken("refresh")).resolves.toMatchObject({ accessToken: "access" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockResolvedValueOnce(new Response("nope", { status: 400 }));
    await expect(refreshAnthropicToken("refresh")).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
