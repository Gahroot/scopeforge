import { useState } from "react";
import { Building2, ChevronDown, ChevronRight, FileText, ListChecks } from "lucide-react";
import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { ScrollArea } from "../components/ui/scroll-area.js";
import { PriceCard } from "./PriceCard.js";
import { SensitivityPanel } from "./SensitivityPanel.js";
import { GuardrailList } from "./GuardrailList.js";
import { PreviewExportBar } from "./PreviewExportBar.js";
import { StylePresetSelector } from "./StylePresetSelector.js";
import { ProposalAnalytics } from "../projects/ProposalAnalytics.js";
import type { ProjectConflictNotice } from "../lib/collaboration.js";
import type { SessionSnapshot } from "../lib/types.js";
import type { ProposalProject } from "../../project/types.js";
import type { ProposalBrand } from "../../proposal/types.js";

export interface DraftPanelProps {
  readonly snapshot: SessionSnapshot | null;
  readonly brands: readonly ProposalBrand[];
  readonly busy: boolean;
  readonly vendorBrand: ProposalBrand | null;
  readonly displayName: string | null;
  readonly stylePresetId?: string | undefined;
  readonly extractingStyle?: boolean | undefined;
  readonly onStylePresetChange?: ((presetId: string | null) => void) | undefined;
  readonly onUploadReference?: ((file: File) => void) | undefined;
  readonly onProjectConflict?: ((conflict: ProjectConflictNotice) => void) | undefined;
  readonly onProjectUpdated?: ((project: ProposalProject) => void) | undefined;
  readonly onProjectActivitySaved?: (() => void) | undefined;
}

function formatMoney(value: number | null): string {
  if (value === null) return "TBD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function DraftPanel({
  snapshot,
  brands,
  busy,
  vendorBrand,
  displayName,
  stylePresetId,
  extractingStyle,
  onStylePresetChange,
  onUploadReference,
  onProjectConflict,
  onProjectUpdated,
  onProjectActivitySaved,
}: DraftPanelProps): JSX.Element {
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

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
  const brand = vendorBrand ?? brands.find((candidate) => candidate.id === draft.brandId);
  const hasProjectId = snapshot.projectId !== undefined;

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

          {(onStylePresetChange !== undefined || onUploadReference !== undefined) && (
            <StylePresetSelector
              selectedPresetId={stylePresetId}
              disabled={busy}
              extracting={extractingStyle}
              onPresetChange={onStylePresetChange ?? (() => {})}
              onUploadReference={onUploadReference}
            />
          )}

          <PriceCard economics={economics} />
          <SensitivityPanel snapshot={snapshot} />

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
          <PreviewExportBar
            snapshot={snapshot}
            disabled={busy}
            vendorBrand={vendorBrand}
            displayName={displayName}
            onProjectConflict={onProjectConflict}
            onProjectUpdated={onProjectUpdated}
            onProjectActivitySaved={onProjectActivitySaved}
          />

          {hasProjectId && (
            <Card>
              <button
                type="button"
                className="flex w-full items-center justify-between p-4 text-left"
                onClick={() => setAnalyticsOpen((prev) => !prev)}
              >
                <CardTitle className="text-sm">Engagement analytics</CardTitle>
                {analyticsOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
              {analyticsOpen && (
                <CardContent>
                  <ProposalAnalytics projectId={snapshot.projectId ?? ""} />
                </CardContent>
              )}
            </Card>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
