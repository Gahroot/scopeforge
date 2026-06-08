import { AlertTriangle, FileDown, RefreshCw, Save } from "lucide-react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import type {
  ProposalProjectArtifactSummaryResponse,
  ProposalProjectStateResponse,
  ProposalProjectUpdatesResponse,
} from "../lib/api.js";
import {
  hasNewerProjectVersion,
  latestVisibleArtifactSummary,
  projectConflictMetadataFromState,
  type ProjectConflictNotice,
} from "../lib/collaboration.js";
import type { ProposalArtifactMetadata } from "../../project/types.js";

export interface CollaborationStatusProps {
  readonly state: ProposalProjectStateResponse;
  readonly update: ProposalProjectUpdatesResponse | null;
  readonly conflict: ProjectConflictNotice | null;
  readonly refreshing: boolean;
  readonly onRefreshLatest: () => void;
}

export function CollaborationStatus({
  state,
  update,
  conflict,
  refreshing,
  onRefreshLatest,
}: CollaborationStatusProps): JSX.Element {
  const latestProject =
    conflict?.latestProject ?? update?.latestProject ?? projectConflictMetadataFromState(state);
  const latestEditor =
    conflict?.latestProject.updatedBy?.displayName ??
    update?.latestVersion.createdBy.displayName ??
    latestProject.updatedBy?.displayName;
  const latestEditorName = latestEditor ?? state.currentVersion.createdBy.displayName;
  const hasNewerVersion = hasNewerProjectVersion(state, update);
  const needsRefresh = conflict !== null || hasNewerVersion;
  const artifactSummary = latestVisibleArtifactSummary(state, update);
  const exportedState = formatExportedState(artifactSummary);

  return (
    <section
      aria-label="Project collaboration status"
      aria-live="polite"
      className="border-b bg-background px-6 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground">
          <Badge variant={needsRefresh ? "warning" : "success"}>
            Viewing v{state.currentVersion.versionNumber}
          </Badge>
          <span className="font-medium text-foreground">
            Latest v{latestProject.currentVersionNumber}
          </span>
          <span>Last editor: {latestEditorName}</span>
          <span className="inline-flex items-center gap-1">
            <Save className="h-3 w-3" />
            Saved v{state.currentVersion.versionNumber} by{" "}
            {state.currentVersion.createdBy.displayName}
          </span>
          <span className="inline-flex items-center gap-1">
            <FileDown className="h-3 w-3" />
            {exportedState}
          </span>
        </div>
        {needsRefresh && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={refreshing}
            onClick={onRefreshLatest}
          >
            <RefreshCw className={refreshing ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
            Refresh to latest
          </Button>
        )}
      </div>
      {conflict !== null && (
        <p className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Conflict during {conflict.action}: {conflict.message} Latest is v
            {conflict.latestProject.currentVersionNumber} by {latestEditorName}. Refresh to latest
            before retrying.
          </span>
        </p>
      )}
      {conflict === null && hasNewerVersion && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          Another collaborator saved v{latestProject.currentVersionNumber} by {latestEditorName}.
          Refresh to review it without reloading the app.
        </p>
      )}
    </section>
  );
}

function formatExportedState(summary: ProposalProjectArtifactSummaryResponse): string {
  const latestPdf = summary.latestPdfArtifact;
  if (latestPdf !== undefined) return formatArtifactActivity("Exported", latestPdf);

  const latestPreview = summary.latestPreviewArtifact;
  if (latestPreview !== undefined) return formatArtifactActivity("Preview saved", latestPreview);

  return "Not exported yet";
}

function formatArtifactActivity(label: string, artifact: ProposalArtifactMetadata): string {
  return `${label} by ${artifact.createdBy.displayName} · ${formatProjectTimestamp(artifact.createdAt)}`;
}

function formatProjectTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
