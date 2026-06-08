import { AlertTriangle, MessagesSquare } from "lucide-react";
import { MessageList } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { Starters } from "./Starters.js";
import { SourceMaterialBox, buildSourceMaterialAgentPrompt } from "../ingest/SourceMaterialBox.js";
import type { AgentStreamApi } from "./useAgentStream.js";
import type { ProposalBrand } from "../../proposal/types.js";

export interface ChatPanelProps {
  readonly agent: AgentStreamApi;
  readonly agentEnabled: boolean;
  readonly displayName: string | null;
  readonly projectId: string | null;
  readonly baseVersion: string | null;
  readonly vendorBrand: ProposalBrand | null;
  readonly clientBrand: ProposalBrand | null;
}

export function ChatPanel({
  agent,
  agentEnabled,
  displayName,
  projectId,
  baseVersion,
  vendorBrand,
  clientBrand,
}: ChatPanelProps): JSX.Element {
  const busy = agent.status !== "idle";
  const empty = agent.messages.length === 0;
  const canStartNewProjectChat = projectId !== null;

  const sendOptions = {
    ...(displayName === null ? {} : { displayName }),
    ...(projectId === null ? {} : { projectId }),
    ...(baseVersion === null ? {} : { baseVersion }),
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
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          Chat works from the saved project draft and brand profiles.
        </div>
        <button
          type="button"
          disabled={busy || !agentEnabled || !canStartNewProjectChat}
          onClick={agent.startNewChatFromLatestProject}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <MessagesSquare className="h-3.5 w-3.5" />
          New chat from latest project
        </button>
      </div>
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
      <SourceMaterialBox
        disabled={busy || !agentEnabled}
        onIngested={(result) =>
          void agent.send(buildSourceMaterialAgentPrompt(result), sendOptions)
        }
      />
      <Composer
        onSend={(message) => void agent.send(message, sendOptions)}
        onStop={agent.stop}
        busy={busy}
        disabled={!agentEnabled}
      />
    </section>
  );
}
