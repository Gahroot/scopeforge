import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { importProjectBrand } from "../lib/api.js";
import type {
  ProposalProject,
  ProposalProjectSourceOfTruth,
  ProposalProjectVersion,
} from "../../project/types.js";
import type { ProposalBrand } from "../../proposal/types.js";

export type BrandRole = "vendor" | "client";

export interface BrandImportProjectUpdate {
  readonly project: ProposalProject;
  readonly currentVersion: ProposalProjectVersion;
  readonly sourceOfTruth: ProposalProjectSourceOfTruth;
}

export interface BrandImportDialogProps {
  readonly role: BrandRole;
  readonly projectId: string | null;
  readonly baseVersionId: string | null;
  readonly displayName: string | null;
  readonly onImported: (
    role: BrandRole,
    brand: ProposalBrand,
    projectUpdate?: BrandImportProjectUpdate,
  ) => void;
  readonly onClose: () => void;
}

const ROLE_COPY: Readonly<Record<BrandRole, { title: string; help: string }>> = {
  vendor: {
    title: "Import my brand",
    help: "Your brand. Drives the proposal's colors, logo, and name in preview and PDF.",
  },
  client: {
    title: "Import client brand",
    help: "The buyer. Seeds who the proposal is prepared for so the AI won't re-ask.",
  },
};

export function BrandImportDialog({
  role,
  projectId,
  baseVersionId,
  displayName,
  onImported,
  onClose,
}: BrandImportDialogProps): JSX.Element {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleImport(): Promise<void> {
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      setError("Enter a website URL.");
      return;
    }
    if (projectId === null || baseVersionId === null) {
      setError("Select a proposal project before importing a website brand.");
      return;
    }

    setBusy(true);
    setError(null);
    const result = await importProjectBrand(projectId, baseVersionId, role, trimmed, displayName);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onImported(role, result.value.brand, {
      project: result.value.project,
      currentVersion: result.value.currentVersion,
      sourceOfTruth: result.value.sourceOfTruth,
    });
    onClose();
  }

  const copy = ROLE_COPY[role];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-md rounded-lg border bg-background p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{copy.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{copy.help}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleImport();
          }}
        >
          <Input
            ref={inputRef}
            type="url"
            inputMode="url"
            placeholder="https://example.com"
            value={url}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
          />
          {error !== null && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Import
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
