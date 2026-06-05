# Local agent LLM configuration

ScopeForge keeps model/provider configuration on the local Node side. Browser code must never import `src/agent/config.node.ts`, read `process.env`, or receive provider API keys from an API response.

## Install surface

The app depends on `@kenkaiiii/gg-ai` for provider types and future model calls. `src/agent/config.node.ts` validates local env vars and can produce safe `StreamOptions` defaults for `gg-ai` without logging or serializing the API key.

## Startup validation

`npm run app:dev` and `npm run app:server` validate the agent config before the local server starts. A missing config is allowed and leaves the agent disabled. Invalid partial config fails fast with env-var names only, never secret values.

Configuration is considered enabled when either:

- `SCOPEFORGE_AGENT_ENABLED=true`, or
- any `SCOPEFORGE_AGENT_*` setting other than `SCOPEFORGE_AGENT_ENABLED` is present.

Set `SCOPEFORGE_AGENT_ENABLED=false` to force-disable local model calls, even if other agent env vars are present in `.env`.

## Loading `.env`

Copy the example and fill local values:

```bash
cp .env.example .env
```

`.env` is gitignored. Load it by exporting variables in your shell or by using Node 24's env-file support:

```bash
node --env-file=.env --import tsx src/server/appServer.ts --dev-ui
node --env-file=.env --import tsx src/server/appServer.ts
```

Do not prefix secrets with `VITE_`; Vite exposes `VITE_*` values to browser bundles.

## Required env vars

| Env var | Required when enabled | Purpose |
| --- | --- | --- |
| `SCOPEFORGE_AGENT_ENABLED` | No | `true` enables validation/model calls; `false` disables them. |
| `SCOPEFORGE_AGENT_PROVIDER` | Yes | One of the supported `@kenkaiiii/gg-ai` provider ids below. |
| `SCOPEFORGE_AGENT_MODEL` | Yes | Provider model string passed through to `gg-ai`. |
| `SCOPEFORGE_AGENT_API_KEY` | Usually | Preferred scoped local key. If unset, provider-specific fallback keys are checked. |

## Provider choices

`src/agent/config.node.ts` accepts these `@kenkaiiii/gg-ai` providers:

| Provider | API key fallback env vars | Model examples / notes |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | Claude model id such as `claude-sonnet-4-6`, `claude-opus-4-8`, or `claude-haiku-4-5`. |
| `openai` | `OPENAI_API_KEY` | OpenAI model id such as `gpt-4.1`, `o3`, or `o4-mini`. |
| `gemini` | `GEMINI_API_KEY`, `GOOGLE_API_KEY` | Gemini model id supported by `gg-ai`'s Gemini transport, such as `gemini-2.5-pro`, `gemini-2.5-flash`, or Gemini 3 preview ids. |
| `glm` | `GLM_API_KEY`, `ZAI_API_KEY`, `Z_AI_API_KEY` | Z.AI/GLM model id such as GLM-5.1 or GLM-4.7 family names. |
| `moonshot` | `MOONSHOT_API_KEY`, `KIMI_API_KEY` | Moonshot/Kimi model id such as the Kimi K2 family; `gg-ai` supplies the default Moonshot base URL. |
| `deepseek` | `DEEPSEEK_API_KEY` | DeepSeek model id such as `deepseek-chat` or `deepseek-reasoner`. |
| `openrouter` | `OPENROUTER_API_KEY` | OpenRouter model slug, for example `anthropic/claude-sonnet-4.5` or another account-enabled slug. |
| `minimax` | `MINIMAX_API_KEY` | MiniMax Anthropic-compatible model id. |
| `xiaomi` | `XIAOMI_API_KEY` | Xiaomi token-plan OpenAI-compatible model id. |

`SCOPEFORGE_AGENT_API_KEY` takes precedence over provider-specific fallback env vars. Use provider-specific keys only when you already have them exported locally.

## Optional request defaults

| Env var | Validation | Passed to `gg-ai` as |
| --- | --- | --- |
| `SCOPEFORGE_AGENT_BASE_URL` | Valid `http` or `https` URL | `baseUrl` |
| `SCOPEFORGE_AGENT_MAX_TOKENS` | Integer `1..1000000` | `maxTokens` |
| `SCOPEFORGE_AGENT_TEMPERATURE` | Number `0..2` | `temperature` |
| `SCOPEFORGE_AGENT_TOP_P` | Number `0..1` | `topP` |
| `SCOPEFORGE_AGENT_THINKING` | `low`, `medium`, `high`, `xhigh`, `max` | `thinking` |
| `SCOPEFORGE_AGENT_CACHE_RETENTION` | `none`, `short`, `long` | `cacheRetention` |
| `SCOPEFORGE_AGENT_WEB_SEARCH` | Boolean (`true/false`, `yes/no`, `on/off`, `1/0`) | `webSearch` |
| `SCOPEFORGE_AGENT_COMPACTION` | Boolean | `compaction` |
| `SCOPEFORGE_AGENT_CLEAR_TOOL_USES` | Boolean | `clearToolUses` |
| `SCOPEFORGE_AGENT_PROMPT_CACHE_KEY` | Non-empty string | `promptCacheKey` |

Provider support differs; unsupported `gg-ai` options may be ignored or rejected by the provider. Prefer minimal defaults first: provider, model, key, and `maxTokens`.

## Browser safety rules

- Keep API keys in `.env`, shell exports, or your password manager only.
- Do not add `VITE_*` secret names; Vite intentionally exposes them to client code.
- Do not import `src/agent/config.node.ts` from `src/main.ts`, `src/ui/*`, render modules, or shared browser code.
- Server startup logs use `summarizeAgentConfig()`, which reports provider/model and the env var name used for the key, but never the key value.
