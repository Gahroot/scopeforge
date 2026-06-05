import { useState } from "react";
import { Download, Eye, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { exportProposalPdf, previewProposal } from "../lib/api.js";
import type { SessionSnapshot } from "../lib/types.js";

export interface PreviewExportBarProps {
  readonly snapshot: SessionSnapshot;
  readonly disabled: boolean;
}

type Action = "preview" | "export" | null;

export function PreviewExportBar({ snapshot, disabled }: PreviewExportBarProps): JSX.Element {
  const [action, setAction] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = !snapshot.validation.ok || snapshot.validation.blocking.length > 0;

  const body = {
    draft: snapshot.fullDraft,
    brandId: snapshot.draft.brandId,
    audience: snapshot.draft.audience,
  };

  async function handlePreview(): Promise<void> {
    setAction("preview");
    setError(null);
    const result = await previewProposal(body);
    setAction(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
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
    const result = await exportProposalPdf(body);
    setAction(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
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
