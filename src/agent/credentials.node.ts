import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "node:process";
import type { AgentCacheRetention, AgentProvider, AgentThinkingLevel } from "./config.node.js";
import { AGENT_PROVIDER_IDS } from "./config.node.js";
import { refreshAnthropicToken, type OAuthCredentials } from "./oauth/anthropic.node.js";
import { OpenAIRefreshTokenInvalidError, refreshOpenAIToken } from "./oauth/openai.node.js";

export type AgentAuthKind = "api_key" | "oauth";

export type AgentOAuthCredentials = OAuthCredentials & {
  readonly accountId?: string;
  readonly email?: string;
};

export type StoredProviderCredentials = AgentOAuthCredentials & {
  authKind: AgentAuthKind;
};

export type StoredAgentSettings = {
  provider: AgentProvider;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  thinking?: AgentThinkingLevel;
  cacheRetention?: AgentCacheRetention;
  webSearch?: boolean;
  compaction?: boolean;
  clearToolUses?: boolean;
  promptCacheKey?: string;
};

type CredentialsFile = {
  settings: StoredAgentSettings;
  credentials: Partial<Record<AgentProvider, StoredProviderCredentials>>;
};

export type ProviderCredentialSummary = {
  provider: AgentProvider;
  configured: boolean;
  authKind?: AgentAuthKind;
  expiresAt?: number;
  accountId?: string;
  email?: string;
};

export const DEFAULT_STORED_AGENT_SETTINGS: StoredAgentSettings = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
};

const FAR_FUTURE_EXPIRES_AT = 4_102_444_800_000;
const OAUTH_REFRESH_SKEW_MS = 30_000;

export function getDefaultCredentialsFilePath(
  inputEnv: Readonly<Record<string, string | undefined>> = env,
): string {
  return (
    inputEnv.SCOPEFORGE_AGENT_CREDENTIALS_FILE ??
    path.join(process.cwd(), ".scopeforge", "agent-credentials.json")
  );
}

export class AgentCredentialsStore {
  private data: CredentialsFile = { settings: DEFAULT_STORED_AGENT_SETTINGS, credentials: {} };
  private loaded = false;

  constructor(private readonly filePath = getDefaultCredentialsFilePath()) {}

  get path(): string {
    return this.filePath;
  }

  async getSettings(): Promise<StoredAgentSettings> {
    await this.ensureLoaded();
    return { ...this.data.settings };
  }

  async updateSettings(settings: Partial<StoredAgentSettings>): Promise<StoredAgentSettings> {
    await this.ensureLoaded();
    this.data.settings = normalizeStoredAgentSettings({ ...this.data.settings, ...settings });
    await this.save();
    return { ...this.data.settings };
  }

  async listCredentialSummaries(): Promise<readonly ProviderCredentialSummary[]> {
    await this.ensureLoaded();
    return AGENT_PROVIDER_IDS.map((provider) => this.summarizeProvider(provider));
  }

  async summarizeCredentials(provider: AgentProvider): Promise<ProviderCredentialSummary> {
    await this.ensureLoaded();
    return this.summarizeProvider(provider);
  }

  async setApiKeyCredentials(
    provider: AgentProvider,
    apiKey: string,
  ): Promise<ProviderCredentialSummary> {
    await this.ensureLoaded();
    this.data.credentials[provider] = {
      authKind: "api_key",
      accessToken: apiKey,
      refreshToken: "",
      expiresAt: FAR_FUTURE_EXPIRES_AT,
    };
    await this.save();
    return this.summarizeProvider(provider);
  }

  async setOAuthCredentials(
    provider: AgentProvider,
    credentials: AgentOAuthCredentials,
  ): Promise<ProviderCredentialSummary> {
    await this.ensureLoaded();
    this.data.credentials[provider] = { ...credentials, authKind: "oauth" };
    await this.save();
    return this.summarizeProvider(provider);
  }

  async clearCredentials(provider: AgentProvider): Promise<ProviderCredentialSummary> {
    await this.ensureLoaded();
    delete this.data.credentials[provider];
    await this.save();
    return this.summarizeProvider(provider);
  }

  async resolveCredentials(
    provider: AgentProvider,
  ): Promise<StoredProviderCredentials | undefined> {
    await this.ensureLoaded();
    const credentials = this.data.credentials[provider];
    if (credentials === undefined) return undefined;
    if (credentials.authKind !== "oauth") return credentials;
    if (!canRefreshOAuthProvider(provider) || Date.now() < credentials.expiresAt - OAUTH_REFRESH_SKEW_MS) {
      return credentials;
    }

    try {
      const refreshed = await refreshOAuthCredentials(provider, credentials.refreshToken);
      this.data.credentials[provider] = { ...refreshed, authKind: "oauth" };
      await this.save();
      return this.data.credentials[provider];
    } catch (error) {
      if (isAuthFailure(error)) {
        delete this.data.credentials[provider];
        await this.save();
        return undefined;
      }
      throw error;
    }
  }

  async refreshCredentials(provider: AgentProvider): Promise<ProviderCredentialSummary> {
    await this.ensureLoaded();
    const credentials = this.data.credentials[provider];
    if (credentials?.authKind !== "oauth" || !canRefreshOAuthProvider(provider)) {
      return this.summarizeProvider(provider);
    }

    try {
      const refreshed = await refreshOAuthCredentials(provider, credentials.refreshToken);
      this.data.credentials[provider] = { ...refreshed, authKind: "oauth" };
      await this.save();
      return this.summarizeProvider(provider);
    } catch (error) {
      if (isAuthFailure(error)) {
        delete this.data.credentials[provider];
        await this.save();
        return this.summarizeProvider(provider);
      }
      throw error;
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content) as Partial<CredentialsFile>;
      this.data = {
        settings: normalizeStoredAgentSettings({
          ...DEFAULT_STORED_AGENT_SETTINGS,
          ...parsed.settings,
        }),
        credentials: parsed.credentials ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.data = { settings: DEFAULT_STORED_AGENT_SETTINGS, credentials: {} };
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    try {
      await fs.writeFile(tmpPath, JSON.stringify(this.data, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
      await fs.rename(tmpPath, this.filePath);
      await fs.chmod(this.filePath, 0o600).catch(() => undefined);
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }

  private summarizeProvider(provider: AgentProvider): ProviderCredentialSummary {
    const credentials = this.data.credentials[provider];
    if (credentials === undefined) return { provider, configured: false };
    return {
      provider,
      configured: true,
      authKind: credentials.authKind,
      expiresAt: credentials.expiresAt,
      ...(credentials.accountId === undefined ? {} : { accountId: credentials.accountId }),
      ...(credentials.email === undefined ? {} : { email: credentials.email }),
    };
  }
}

function normalizeStoredAgentSettings(settings: StoredAgentSettings): StoredAgentSettings {
  const model = normalizeAgentModelId(settings.model);
  return model === settings.model ? settings : { ...settings, model };
}

function normalizeAgentModelId(model: string): string {
  switch (model) {
    case "opus-4.8":
    case "claude-opus-4.8":
      return "claude-opus-4-8";
    default:
      return model;
  }
}

function canRefreshOAuthProvider(provider: AgentProvider): boolean {
  return provider === "anthropic" || provider === "openai";
}

async function refreshOAuthCredentials(
  provider: AgentProvider,
  refreshToken: string,
): Promise<AgentOAuthCredentials> {
  if (provider === "anthropic") return refreshAnthropicToken(refreshToken);
  if (provider === "openai") return refreshOpenAIToken(refreshToken);
  throw new Error(`OAuth refresh is not supported for provider ${provider}.`);
}

function isAuthFailure(error: unknown): boolean {
  if (error instanceof OpenAIRefreshTokenInvalidError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\((401|400)\)/.test(message) ||
    /invalid_grant|invalid_token|invalid.*refresh|unauthorized/i.test(message)
  );
}
