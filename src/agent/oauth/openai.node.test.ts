import { describe, expect, it, vi } from "vitest";
import {
  getOpenAIAccountId,
  OpenAIRefreshTokenInvalidError,
  refreshOpenAIToken,
} from "./openai.node.js";

function makeJwt(payload: Readonly<Record<string, unknown>>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("openai oauth", () => {
  it("extracts the ChatGPT account id from the OpenAI auth claim", () => {
    const token = makeJwt({
      email: "operator@example.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
    });

    expect(getOpenAIAccountId(token)).toBe("account-123");
    expect(getOpenAIAccountId("not-a-jwt")).toBeNull();
  });

  it("refreshes OpenAI subscription credentials with account metadata", async () => {
    const accessToken = makeJwt({
      email: "operator@example.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        access_token: accessToken,
        refresh_token: "next-refresh-token",
        expires_in: 3600,
      }),
    );

    const credentials = await refreshOpenAIToken("refresh-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://auth.openai.com/oauth/token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(credentials).toMatchObject({
      accessToken,
      refreshToken: "next-refresh-token",
      accountId: "account-123",
      email: "operator@example.com",
    });
    fetchMock.mockRestore();
  });

  it("preserves the previous refresh token when the refresh response omits one", async () => {
    const accessToken = makeJwt({
      email: "operator@example.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        access_token: accessToken,
        expires_in: 3600,
      }),
    );

    await expect(refreshOpenAIToken("keep-this-refresh")).resolves.toMatchObject({
      accessToken,
      refreshToken: "keep-this-refresh",
      accountId: "account-123",
    });
    fetchMock.mockRestore();
  });

  it("marks rejected refresh tokens as invalid", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("invalid_grant", { status: 400 }));

    await expect(refreshOpenAIToken("expired-refresh-token")).rejects.toThrow(
      OpenAIRefreshTokenInvalidError,
    );
    fetchMock.mockRestore();
  });
});
