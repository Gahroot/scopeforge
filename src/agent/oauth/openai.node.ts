import crypto from "node:crypto";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AgentCredentialsStore } from "../credentials.node.js";
import { generatePKCE } from "./pkce.js";

const DEFAULT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_PORT = 1455;
const REDIRECT_HOST = "127.0.0.1";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const ORIGINATOR = "scopeforge";
const LOGIN_TIMEOUT_MS = 120_000;

export interface OpenAIOAuthCredentials {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly accountId: string;
  readonly email?: string;
}

export interface PendingOpenAIOAuth {
  readonly state: string;
  readonly authUrl: string;
  readonly callbackUrl: string;
  readonly expiresAt: number;
}

export interface StartOpenAIOAuthOptions {
  readonly credentialsStore: AgentCredentialsStore;
  readonly now?: number;
  readonly timeoutMs?: number;
}

export class OpenAIRefreshTokenInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIRefreshTokenInvalidError";
  }
}

function clientId(): string {
  const raw = (process.env.OPENAI_OAUTH_CLIENT_ID ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_CLIENT_ID;
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    const payload = parts[1];
    if (parts.length !== 3 || payload === undefined || payload.length === 0) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getOpenAIAccountId(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH] as { chatgpt_account_id?: string } | undefined;
  const accountId = auth?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

function getOpenAIEmail(accessToken: string): string | undefined {
  const payload = decodeJwt(accessToken);
  const candidate = payload?.email;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

export async function startOpenAIOAuth(
  options: StartOpenAIOAuthOptions,
): Promise<PendingOpenAIOAuth> {
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomBytes(16).toString("hex");
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const expiresAt = (options.now ?? Date.now()) + timeoutMs;
  const authUrl = buildAuthorizeUrl(state, challenge);
  const server = http.createServer((request, response) => {
    void handleCallbackRequest({
      request,
      response,
      expectedState: state,
      verifier,
      credentialsStore: options.credentialsStore,
      server,
    });
  });

  await listen(server);
  const timeout = setTimeout(() => server.close(), timeoutMs);
  timeout.unref();
  server.once("close", () => clearTimeout(timeout));

  return { state, authUrl, callbackUrl: REDIRECT_URI, expiresAt };
}

function buildAuthorizeUrl(state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", ORIGINATOR);
  return url.toString();
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(REDIRECT_PORT, REDIRECT_HOST);
  });
}

interface HandleCallbackRequestInput {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly expectedState: string;
  readonly verifier: string;
  readonly credentialsStore: AgentCredentialsStore;
  readonly server: Server;
}

async function handleCallbackRequest(input: HandleCallbackRequestInput): Promise<void> {
  const requestUrl = new URL(input.request.url ?? "/", REDIRECT_URI);
  if (requestUrl.pathname !== "/auth/callback") {
    sendCallbackHtml(input.response, 404, "Not found", "This callback server only handles OpenAI sign-in.");
    return;
  }

  const state = requestUrl.searchParams.get("state");
  if (state !== input.expectedState) {
    sendCallbackHtml(input.response, 400, "State mismatch", "OpenAI sign-in state did not match. Try again from ScopeForge settings.");
    return;
  }

  const error = requestUrl.searchParams.get("error");
  if (error !== null) {
    const description = requestUrl.searchParams.get("error_description") ?? error;
    sendCallbackHtml(input.response, 400, "OpenAI sign-in failed", description);
    input.server.close();
    return;
  }

  const code = requestUrl.searchParams.get("code");
  if (code === null || code.length === 0) {
    sendCallbackHtml(input.response, 400, "Missing code", "OpenAI did not return an authorization code. Try signing in again.");
    input.server.close();
    return;
  }

  try {
    const credentials = await completeOpenAIOAuth({ code, verifier: input.verifier });
    await input.credentialsStore.setOAuthCredentials("openai", credentials);
    sendCallbackHtml(
      input.response,
      200,
      "Signed in to ScopeForge",
      "You can close this tab and return to ScopeForge settings.",
    );
  } catch (error_) {
    sendCallbackHtml(
      input.response,
      500,
      "OpenAI sign-in failed",
      error_ instanceof Error ? error_.message : String(error_),
    );
  } finally {
    input.server.close();
  }
}

function sendCallbackHtml(
  response: ServerResponse,
  status: number,
  title: string,
  message: string,
): void {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(
    [
      "<!doctype html>",
      "<html>",
      "<head><meta charset=\"utf-8\"><title>",
      escapeHtml(title),
      "</title></head>",
      '<body style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;text-align:center;padding:80px 24px;color:#111827;">',
      `<h1>${escapeHtml(title)}</h1>`,
      `<p>${escapeHtml(message)}</p>`,
      "</body></html>",
    ].join(""),
  );
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function completeOpenAIOAuth(input: {
  readonly code: string;
  readonly verifier: string;
}): Promise<OpenAIOAuthCredentials> {
  const token = await postOpenAITokenRequest({
    grant_type: "authorization_code",
    client_id: clientId(),
    code: input.code,
    redirect_uri: REDIRECT_URI,
    code_verifier: input.verifier,
  });
  return tokenResponseToCredentials(token, "OpenAI sign-in succeeded but the returned token does not carry a ChatGPT account id.");
}

export async function refreshOpenAIToken(refreshToken: string): Promise<OpenAIOAuthCredentials> {
  const token = await postOpenAITokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId(),
    },
    true,
  );
  return tokenResponseToCredentials(token, "Refreshed OpenAI token is missing the ChatGPT account id claim.");
}

type TokenResponse = {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
};

async function postOpenAITokenRequest(
  body: Record<string, string>,
  refresh = false,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (refresh && (response.status === 400 || response.status === 401)) {
      throw new OpenAIRefreshTokenInvalidError(
        `OpenAI refresh rejected (${response.status}): ${text || "invalid_grant"}`,
      );
    }
    throw new Error(`OpenAI token ${refresh ? "refresh" : "exchange"} failed (${response.status}): ${text}`);
  }

  return (await response.json()) as TokenResponse;
}

function tokenResponseToCredentials(token: TokenResponse, missingAccountMessage: string): OpenAIOAuthCredentials {
  const accountId = getOpenAIAccountId(token.access_token);
  if (accountId === null) throw new OpenAIRefreshTokenInvalidError(missingAccountMessage);
  const email = getOpenAIEmail(token.access_token);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    accountId,
    ...(email === undefined ? {} : { email }),
  };
}
