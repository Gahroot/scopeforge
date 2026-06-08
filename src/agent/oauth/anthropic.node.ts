import crypto from "node:crypto";
import { generatePKCE } from "./pkce.js";

const CLIENT_ID = atob("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URLS = [
  "https://platform.claude.com/v1/oauth/token",
  "https://console.anthropic.com/v1/oauth/token",
] as const;
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const USER_AGENT = "ScopeForge/1.0 Anthropic OAuth";

export type OAuthCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type PendingAnthropicOAuth = {
  state: string;
  verifier: string;
  authUrl: string;
  expiresAt: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

function toCredentials(data: TokenResponse): OAuthCredentials {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

async function postTokenRequest(body: Record<string, string>, label: string): Promise<TokenResponse> {
  const encoded = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "anthropic-beta": OAUTH_BETA_HEADER,
  };
  let lastError: Error | undefined;
  for (const url of TOKEN_URLS) {
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body: encoded });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      continue;
    }
    if (response.ok) {
      return (await response.json()) as TokenResponse;
    }
    const text = await response.text();
    if (response.status >= 400 && response.status < 500) {
      throw new Error(`Anthropic ${label} failed (${response.status}): ${text}`);
    }
    lastError = new Error(`Anthropic ${label} failed (${response.status}): ${text}`);
  }
  throw lastError ?? new Error(`Anthropic ${label} failed: all endpoints unreachable`);
}

export async function startAnthropicOAuth(now = Date.now()): Promise<PendingAnthropicOAuth> {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return {
    state,
    verifier,
    authUrl: `${AUTHORIZE_URL}?${params}`,
    expiresAt: now + 10 * 60 * 1000,
  };
}

export function parseAnthropicCodeInput(input: string): { code: string; state?: string } {
  const trimmed = input.trim();
  const [code, state, extra] = trimmed.split("#");
  if (!code || extra !== undefined) {
    throw new Error("Invalid code format. Paste either the code or code#state from Anthropic.");
  }
  return state ? { code, state } : { code };
}

export async function completeAnthropicOAuth(input: {
  code: string;
  state?: string;
  expectedState: string;
  verifier: string;
}): Promise<OAuthCredentials> {
  if (input.state !== undefined && input.state !== input.expectedState) {
    throw new Error("Invalid code or state mismatch. Please try again.");
  }
  const data = await postTokenRequest(
    {
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: input.code,
      state: input.expectedState,
      redirect_uri: REDIRECT_URI,
      code_verifier: input.verifier,
    },
    "token exchange",
  );
  return toCredentials(data);
}

export async function refreshAnthropicToken(refreshToken: string): Promise<OAuthCredentials> {
  const data = await postTokenRequest(
    {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    },
    "token refresh",
  );
  return toCredentials(data);
}
