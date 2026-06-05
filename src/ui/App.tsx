import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { ChatPanel } from "./chat/ChatPanel.js";
import { DraftPanel } from "./draft/DraftPanel.js";
import { useAgentStream } from "./chat/useAgentStream.js";
import { fetchBrands, fetchHealth, type HealthResponse } from "./lib/api.js";
import type { ProposalBrand } from "../proposal/types.js";

export function App(): JSX.Element {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [brands, setBrands] = useState<readonly ProposalBrand[]>([]);
  const agent = useAgentStream();

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const [healthResult, brandsResult] = await Promise.all([
        fetchHealth(controller.signal),
        fetchBrands(controller.signal),
      ]);
      if (healthResult.ok) {
        setHealth(healthResult.value);
        setAgentEnabled(healthResult.value.agent.enabled);
      }
      if (brandsResult.ok) setBrands(brandsResult.value.brands);
    })();
    return () => controller.abort();
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">ScopeForge</div>
              <div className="text-xs text-muted-foreground">Proposal Copilot</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {health === null
              ? "Connecting…"
              : `API v${health.apiVersion}${agentEnabled ? "" : " · agent offline"}`}
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <ChatPanel agent={agent} agentEnabled={agentEnabled} />
          <DraftPanel snapshot={agent.snapshot} brands={brands} busy={agent.status !== "idle"} />
        </main>
      </div>
    </TooltipProvider>
  );
}
