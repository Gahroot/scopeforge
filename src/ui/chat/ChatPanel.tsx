import { AlertTriangle } from "lucide-react";
import { MessageList } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { Starters } from "./Starters.js";
import type { AgentStreamApi } from "./useAgentStream.js";
import type { ProposalBrand } from "../../proposal/types.js";

export interface ChatPanelProps {
  readonly agent: AgentStreamApi;
  readonly agentEnabled: boolean;
  readonly displayName: string | null;
  readonly vendorBrand: ProposalBrand | null;
  readonly clientBrand: ProposalBrand | null;
}

export function ChatPanel({
  agent,
  agentEnabled,
  displayName,
  vendorBrand,
  clientBrand,
}: ChatPanelProps): JSX.Element {
  const busy = agent.status !== "idle";
  const empty = agent.messages.length === 0;

  const sendOptions = {
    ...(displayName === null ? {} : { displayName }),
    ...(vendorBrand === null ? {} : { vendorBrand }),
    ...(clientBrand === null ? {} : { clientBrand }),
  };

  return (
    <section className="flex min-h-0 flex-col border-r">
      {!agentEnabled && (
        <div className="flex items-center gap-2 border-b bg-warning/10 px-4 py-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          Agent is offline. Set SCOPEFORGE_AGENT_* env vars to enable the copilot.
        </div>
      )}
      <div className="min-h-0 flex-1">
        {empty ? (
          <Starters
            onPick={(prompt) => void agent.send(prompt, sendOptions)}
            disabled={busy || !agentEnabled}
          />
        ) : (
          <MessageList messages={agent.messages} />
        )}
      </div>
      <Composer
        onSend={(message) => void agent.send(message, sendOptions)}
        onStop={agent.stop}
        busy={busy}
        disabled={!agentEnabled}
      />
    </section>
  );
}
