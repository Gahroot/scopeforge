import { Building2, FileText, ListChecks } from "lucide-react";
import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { ScrollArea } from "../components/ui/scroll-area.js";
import { PriceCard } from "./PriceCard.js";
import { GuardrailList } from "./GuardrailList.js";
import { PreviewExportBar } from "./PreviewExportBar.js";
import type { SessionSnapshot } from "../lib/types.js";
import type { ProposalBrand } from "../../proposal/types.js";

export interface DraftPanelProps {
  readonly snapshot: SessionSnapshot | null;
  readonly brands: readonly ProposalBrand[];
  readonly busy: boolean;
}

function formatMoney(value: number | null): string {
  if (value === null) return "TBD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function DraftPanel({ snapshot, brands, busy }: DraftPanelProps): JSX.Element {
  if (snapshot === null) {
    return (
      <aside className="hidden min-h-0 flex-col bg-muted/30 lg:flex">
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <p className="text-sm text-muted-foreground">
            Your live proposal draft — price, value, and guardrails — appears here as you chat.
          </p>
        </div>
      </aside>
    );
  }

  const { draft, economics, validation } = snapshot;
  const brand = brands.find((candidate) => candidate.id === draft.brandId);

  return (
    <aside className="hidden min-h-0 flex-col bg-muted/30 lg:flex">
      <ScrollArea className="h-full">
        <div className="space-y-3 p-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4" />
                  {draft.title}
                </CardTitle>
                <Badge variant="secondary">{draft.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                <span>
                  {draft.companyName}
                  {draft.buyerName !== undefined ? ` · ${draft.buyerName}` : ""}
                </span>
              </div>
              <p className="text-sm">{draft.recommendation}</p>
              {brand !== undefined && (
                <div className="text-xs text-muted-foreground">Brand: {brand.name}</div>
              )}
            </CardContent>
          </Card>

          <PriceCard economics={economics} />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pricing phases</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {draft.phases.length === 0 ? (
                <p className="text-xs text-muted-foreground">No pricing phases yet.</p>
              ) : (
                draft.phases.map((phase) => (
                  <div
                    key={phase.name}
                    className="flex items-center justify-between border-b border-dashed pb-1 text-sm last:border-0 last:pb-0"
                  >
                    <span>{phase.name}</span>
                    <span className="font-medium">{formatMoney(phase.price)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {draft.nextSteps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ListChecks className="h-4 w-4" />
                  Next steps
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-1 pl-4 text-sm">
                  {draft.nextSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          <GuardrailList validation={validation} />
          <PreviewExportBar snapshot={snapshot} disabled={busy} />
        </div>
      </ScrollArea>
    </aside>
  );
}
