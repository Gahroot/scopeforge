import { useCallback, useEffect, useId, useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  clearAgentCredentials,
  completeAnthropicOAuth,
  fetchAgentSettings,
  saveAgentApiKey,
  updateAgentSettings,
  type AgentCredentialSummary,
  type AgentSettingsResponse,
} from "../lib/api.js";

const ANTHROPIC_OAUTH_AUTHORIZE_PATH = "/api/agent/oauth/anthropic/authorize";
const OPENAI_OAUTH_AUTHORIZE_PATH = "/api/agent/oauth/openai/authorize";

const DEFAULT_PROVIDER_OPTIONS = [
  { provider: "anthropic", label: "Anthropic" },
  { provider: "openai", label: "OpenAI" },
  { provider: "gemini", label: "Gemini" },
  { provider: "glm", label: "GLM/Z.ai" },
  { provider: "moonshot", label: "Moonshot/Kimi" },
  { provider: "deepseek", label: "DeepSeek" },
  { provider: "openrouter", label: "OpenRouter" },
  { provider: "minimax", label: "MiniMax" },
  { provider: "xiaomi", label: "Xiaomi" },
] as const;

const PROVIDER_HELP: Readonly<
  Record<string, { readonly exampleModel: string; readonly note: string }>
> = {
  anthropic: {
    exampleModel: "claude-sonnet-4-20250514",
    note: "Use an Anthropic API key or Claude/Anthropic OAuth.",
  },
  openai: {
    exampleModel: "gpt-5.5",
    note: "Use an OpenAI API key, or sign in with ChatGPT to route OpenAI models through your subscription.",
  },
  gemini: {
    exampleModel: "gemini-2.5-pro",
    note: "Uses Gemini/Google API keys.",
  },
  glm: {
    exampleModel: "glm-4.7",
    note: "Uses GLM/Z.ai API keys.",
  },
  moonshot: {
    exampleModel: "kimi-k2.6",
    note: "Uses Moonshot/Kimi API keys; the default Moonshot endpoint is supplied server-side.",
  },
  deepseek: {
    exampleModel: "deepseek-chat",
    note: "Uses DeepSeek API keys.",
  },
  openrouter: {
    exampleModel: "anthropic/claude-sonnet-4.5",
    note: "Uses OpenRouter API keys and provider/model slugs enabled on that account.",
  },
  minimax: {
    exampleModel: "MiniMax-M2",
    note: "Uses MiniMax API keys through the Anthropic-compatible transport.",
  },
  xiaomi: {
    exampleModel: "mimo-v2.5",
    note: "Uses Xiaomi/MiMo token-plan API keys.",
  },
};

interface AgentSettingsDialogProps {
  readonly onAgentChanged: () => Promise<void>;
}

export function AgentSettingsDialog({ onAgentChanged }: AgentSettingsDialogProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AgentSettingsResponse | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [codeWithState, setCodeWithState] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const modelInputId = useId();

  const loadSettings = useCallback(async (): Promise<void> => {
    const result = await fetchAgentSettings();
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setSettings(result.value);
    setProvider(result.value.settings.provider);
    setModel(result.value.settings.model);
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadSettings();
  }, [open, loadSettings]);

  const providerOptions = settings?.providers ?? DEFAULT_PROVIDER_OPTIONS;
  const selectedCredentials = settings?.credentials.find((item) => item.provider === provider);
  const selectedProviderLabel =
    providerOptions.find((item) => item.provider === provider)?.label ?? provider;
  const selectedProviderHelp = PROVIDER_HELP[provider] ?? {
    exampleModel: "provider-model-id",
    note: "Model IDs are passed through to the selected provider.",
  };

  const runMutation = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const nextMessage = await action();
      await loadSettings();
      await onAgentChanged();
      setMessage(nextMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings className="mr-2 h-4 w-4" /> Settings
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">LLM Settings</h2>
                <p className="text-sm text-muted-foreground">
                  {settings?.agent.enabled
                    ? `Online: ${settings.agent.provider} · ${settings.agent.model}`
                    : "Agent offline"}
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Provider
                <select
                  className="h-9 rounded-md border bg-background px-3"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  {providerOptions.map((item) => (
                    <option key={item.provider} value={item.provider}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm" htmlFor={modelInputId}>
                Model
                <Input
                  id={modelInputId}
                  value={model}
                  placeholder={selectedProviderHelp.exampleModel}
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {selectedProviderLabel}: {selectedProviderHelp.note}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void runMutation(async () => {
                    const result = await updateAgentSettings({ provider, model });
                    if (!result.ok) throw new Error(result.error.message);
                    return "Settings saved.";
                  })
                }
              >
                Save provider/model
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void runMutation(async () => "Status refreshed.")}
              >
                Refresh status
              </Button>
            </div>

            <ProviderCredentialList
              credentials={settings?.credentials ?? []}
              selectedProvider={provider}
            />

            <div className="mt-5 rounded-md border p-4">
              <div className="mb-2 text-sm font-medium">API key for {selectedProviderLabel}</div>
              <p className="mb-3 text-xs text-muted-foreground">
                Status: {credentialStatus(selectedCredentials)}. Existing keys are never shown.
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  placeholder="Paste API key"
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <Button
                  type="button"
                  disabled={busy || apiKey.trim().length === 0}
                  onClick={() =>
                    void runMutation(async () => {
                      const result = await saveAgentApiKey(provider, apiKey);
                      if (!result.ok) throw new Error(result.error.message);
                      setApiKey("");
                      return "API key saved.";
                    })
                  }
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void runMutation(async () => {
                      const result = await clearAgentCredentials(provider);
                      if (!result.ok) throw new Error(result.error.message);
                      return "Credentials cleared.";
                    })
                  }
                >
                  Clear
                </Button>
              </div>
            </div>

            {provider === "anthropic" && (
              <div className="mt-4 rounded-md border p-4">
                <div className="mb-2 text-sm font-medium">Anthropic OAuth</div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Open Claude, approve access, then paste the returned code#state below.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild className="w-full sm:w-auto" size="lg">
                    <a
                      href={ANTHROPIC_OAUTH_AUTHORIZE_PATH}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        setMessage("Claude sign-in opened. Paste code#state below after approving.")
                      }
                    >
                      Sign in with Claude/Anthropic
                    </a>
                  </Button>
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    value={codeWithState}
                    placeholder="Paste code#state"
                    onChange={(event) => setCodeWithState(event.target.value)}
                  />
                  <Button
                    type="button"
                    disabled={busy || codeWithState.trim().length === 0}
                    onClick={() =>
                      void runMutation(async () => {
                        const result = await completeAnthropicOAuth(codeWithState);
                        if (!result.ok) throw new Error(result.error.message);
                        setCodeWithState("");
                        return "Anthropic OAuth connected.";
                      })
                    }
                  >
                    Complete
                  </Button>
                </div>
              </div>
            )}

            {provider === "openai" && (
              <div className="mt-4 rounded-md border p-4">
                <div className="mb-2 text-sm font-medium">OpenAI subscription</div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Sign in with ChatGPT to use OpenAI Codex models through your subscription.
                  ScopeForge stores the OAuth token locally and refreshes it server-side.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild className="w-full sm:w-auto" size="lg">
                    <a
                      href={OPENAI_OAUTH_AUTHORIZE_PATH}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() =>
                        setMessage(
                          "OpenAI sign-in opened. Return here after the browser says you are signed in, then refresh status.",
                        )
                      }
                    >
                      Sign in with ChatGPT/OpenAI
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void runMutation(async () => "OpenAI status refreshed.")}
                  >
                    Refresh status
                  </Button>
                </div>
              </div>
            )}

            {message !== null && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
          </div>
        </div>
      )}
    </>
  );
}

function ProviderCredentialList({
  credentials,
  selectedProvider,
}: {
  readonly credentials: readonly AgentCredentialSummary[];
  readonly selectedProvider: string;
}): JSX.Element | null {
  if (credentials.length === 0) return null;
  return (
    <div className="mt-5 rounded-md border p-4">
      <div className="mb-3 text-sm font-medium">Configured providers</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {credentials.map((credential) => (
          <div
            key={credential.provider}
            className={`rounded-md border px-3 py-2 text-xs ${
              credential.provider === selectedProvider ? "border-primary" : "border-border"
            }`}
          >
            <div className="font-medium">{providerLabel(credential.provider)}</div>
            <div className="text-muted-foreground">{credentialStatus(credential)}</div>
            {credential.email !== undefined && (
              <div className="truncate text-muted-foreground">{credential.email}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function credentialStatus(credential: AgentCredentialSummary | undefined): string {
  if (credential === undefined || !credential.configured) return "not configured";
  const kind = credential.authKind === "oauth" ? "OAuth" : "API key";
  const expiry =
    credential.expiresAt === undefined ? "" : ` · expires ${formatExpiry(credential.expiresAt)}`;
  return `${kind} configured${expiry}`;
}

function formatExpiry(expiresAt: number): string {
  if (expiresAt > 4_000_000_000_000) return "never";
  return new Date(expiresAt).toLocaleDateString();
}

function providerLabel(provider: string): string {
  return DEFAULT_PROVIDER_OPTIONS.find((item) => item.provider === provider)?.label ?? provider;
}
