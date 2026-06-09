import { useState } from "react";
import { Download, Eye, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button.js";
import {
  exportProposalPdf,
  exportProposalProjectPdf,
  previewProposal,
  previewProposalProject,
  type ApiError,
  type ProjectProposalRequestBody,
  type ProposalRequestBody,
} from "../lib/api.js";
import { ShareProposalButton } from "./ShareProposalButton.js";
import { apiErrorToProjectConflict, type ProjectConflictNotice } from "../lib/collaboration.js";
import type { SessionSnapshot } from "../lib/types.js";
import type { ProposalProject } from "../../project/types.js";
import type { ProposalBrand } from "../../proposal/types.js";

export interface PreviewExportBarProps {
  readonly snapshot: SessionSnapshot;
  readonly disabled: boolean;
  readonly vendorBrand?: ProposalBrand | null;
  readonly displayName: string | null;
  readonly onProjectConflict?: ((conflict: ProjectConflictNotice) => void) | undefined;
  readonly onProjectUpdated?: ((project: ProposalProject) => void) | undefined;
  readonly onProjectActivitySaved?: (() => void) | undefined;
}

type Action = "preview" | "export" | null;

export function PreviewExportBar({
  snapshot,
  disabled,
  vendorBrand,
  displayName,
  onProjectConflict,
  onProjectUpdated,
  onProjectActivitySaved,
}: PreviewExportBarProps): JSX.Element {
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = !snapshot.validation.ok || snapshot.validation.blocking.length > 0;

  const body: ProposalRequestBody = {
    draft: snapshot.fullDraft,
    audience: snapshot.draft.audience,
    ...(displayName === null ? {} : { displayName }),
    ...(vendorBrand === undefined || vendorBrand === null
      ? { brandId: snapshot.draft.brandId }
      : { brand: vendorBrand }),
  };
  const projectRequest: {
    readonly projectId: string;
    readonly body: ProjectProposalRequestBody;
  } | null =
    snapshot.projectId === undefined || snapshot.projectVersionId === undefined
      ? null
      : {
          projectId: snapshot.projectId,
          body: { ...body, baseVersionId: snapshot.projectVersionId },
        };

  async function handlePreview(): Promise<void> {
    setAction("preview");
    setError(null);
    const result =
      projectRequest === null
        ? await previewProposal(body)
        : await previewProposalProject(projectRequest.projectId, projectRequest.body);
    setAction(null);
    if (!result.ok) {
      handleProjectActionError("preview", result.error, onProjectConflict, setError);
      return;
    }
    if (result.value.project !== undefined) onProjectUpdated?.(result.value.project);
    const win = window.open("", "_blank");
    if (win !== null) {
      win.document.open();
      win.document.write(result.value.html);
      win.document.close();
    }
  }

  async function handleExport(): Promise<void> {
    setAction("export");
    setError(null);
    const result =
      projectRequest === null
        ? await exportProposalPdf(body)
        : await exportProposalProjectPdf(projectRequest.projectId, projectRequest.body);
    setAction(null);
    if (!result.ok) {
      handleProjectActionError("export", result.error, onProjectConflict, setError);
      return;
    }
    if (projectRequest !== null) onProjectActivitySaved?.();
    const url = URL.createObjectURL(result.value.bytes);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.value.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={disabled || blocked || action !== null}
          onClick={() => void handlePreview()}
        >
          {action === "preview" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          Preview
        </Button>
        <Button
          className="flex-1"
          disabled={disabled || blocked || action !== null}
          onClick={() => void handleExport()}
        >
          {action === "export" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export PDF
        </Button>
        <ShareProposalButton
          projectId={snapshot.projectId}
          disabled={disabled || blocked || action !== null}
        />
      </div>
      {blocked && (
        <p className="text-xs text-muted-foreground">
          Finish the draft and clear guardrail errors to preview or export.
        </p>
      )}
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function handleProjectActionError(
  action: Exclude<Action, null>,
  error: ApiError,
  onProjectConflict: ((conflict: ProjectConflictNotice) => void) | undefined,
  setError: (message: string) => void,
): void {
  const conflict = apiErrorToProjectConflict(error, action, new Date().toISOString());
  if (conflict !== null) onProjectConflict?.(conflict);
  setError(error.message);
}
