import { useCallback, useEffect, useState } from "react";
import { CheckCircle, FileCheck, Loader2, PenTool, Type } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { acceptProposal, fetchAcceptance, type AcceptanceRecord } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { SignatureCanvas } from "./SignatureCanvas.js";
import { TypedSignature } from "./TypedSignature.js";

export interface AcceptancePanelProps {
  readonly projectId: string;
  readonly versionId: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

type SignatureMode = "typed" | "drawn";

interface AcceptanceFormState {
  readonly clientName: string;
  readonly clientTitle: string;
  readonly clientEmail: string;
  readonly signatureMode: SignatureMode;
  readonly typedName: string;
  readonly drawnDataUrl: string;
}

const EMPTY_FORM: AcceptanceFormState = {
  clientName: "",
  clientTitle: "",
  clientEmail: "",
  signatureMode: "typed",
  typedName: "",
  drawnDataUrl: "",
};

export function AcceptancePanel({
  projectId,
  versionId,
  disabled = false,
  className,
}: AcceptancePanelProps): JSX.Element {
  const [form, setForm] = useState<AcceptanceFormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<AcceptanceRecord | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setChecking(true);
      const result = await fetchAcceptance(projectId);
      if (!cancelled && result.ok && result.value !== null) {
        setRecord(result.value);
      }
      if (!cancelled) setChecking(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const signatureData = form.signatureMode === "typed" ? form.typedName.trim() : form.drawnDataUrl;
  const hasSignature = signatureData.length > 0;
  const canSubmit = !disabled && !busy && form.clientName.trim().length > 0 && hasSignature;

  const handleTypedSignature = useCallback((_dataUrl: string): void => {
    // Typed mode sends the raw text name as signatureData,
    // so the rendered dataUrl is unused here.
  }, []);

  const handleDrawnSignature = useCallback((dataUrl: string): void => {
    setForm((prev) => ({ ...prev, drawnDataUrl: dataUrl }));
  }, []);

  const handleClearDrawn = useCallback((): void => {
    setForm((prev) => ({ ...prev, drawnDataUrl: "" }));
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const clientTitle = form.clientTitle.trim();
      const clientEmail = form.clientEmail.trim();
      const result = await acceptProposal(projectId, {
        versionId,
        clientName: form.clientName.trim(),
        ...(clientTitle.length === 0 ? {} : { clientTitle }),
        ...(clientEmail.length === 0 ? {} : { clientEmail }),
        signatureType: form.signatureMode,
        signatureData,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setRecord(result.value);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [
    canSubmit,
    projectId,
    versionId,
    form.clientName,
    form.clientTitle,
    form.clientEmail,
    form.signatureMode,
    signatureData,
  ]);

  // Already accepted — show confirmation
  if (record !== null) {
    return (
      <Card className={cn("border-success/30 bg-success/5", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-success">
            <CheckCircle className="h-5 w-5" />
            Proposal Accepted
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="font-medium text-muted-foreground">Accepted by</dt>
              <dd>{record.clientName}</dd>
            </div>
            {record.clientTitle !== undefined && record.clientTitle.length > 0 && (
              <div className="flex gap-2">
                <dt className="font-medium text-muted-foreground">Title</dt>
                <dd>{record.clientTitle}</dd>
              </div>
            )}
            {record.clientEmail !== undefined && record.clientEmail.length > 0 && (
              <div className="flex gap-2">
                <dt className="font-medium text-muted-foreground">Email</dt>
                <dd>{record.clientEmail}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="font-medium text-muted-foreground">Date</dt>
              <dd>{new Date(record.acceptedAt).toLocaleDateString()}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-muted-foreground">Signature method</dt>
              <dd className="capitalize">{record.signatureType}</dd>
            </div>
          </dl>
          {record.signatureType === "drawn" && record.signatureData.length > 0 && (
            <div className="mt-3">
              <img
                src={record.signatureData}
                alt="Client signature"
                className="max-h-16 rounded border bg-white p-1"
              />
            </div>
          )}
          {record.signatureType === "typed" && record.signatureData.length > 0 && (
            <div className="mt-3">
              <span
                className="text-2xl"
                style={{
                  fontFamily: "'Brush Script MT', 'Segoe Script', cursive",
                  color: "#1a1a2e",
                }}
              >
                {record.signatureData}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border-muted-foreground/20", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCheck className="h-5 w-5 text-muted-foreground" />
          Accept Proposal
        </CardTitle>
      </CardHeader>
      <CardContent>
        {checking ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking acceptance status…
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
            className="space-y-4"
          >
            {/* ---- Client info fields ---- */}
            <div className="space-y-3">
              <div>
                <label htmlFor="acceptance-client-name" className="mb-1 block text-sm font-medium">
                  Client Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="acceptance-client-name"
                  value={form.clientName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, clientName: event.target.value }))
                  }
                  disabled={disabled || busy}
                  placeholder="Jane Doe"
                  required
                  autoComplete="name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="acceptance-client-title"
                    className="mb-1 block text-sm font-medium text-muted-foreground"
                  >
                    Title
                  </label>
                  <Input
                    id="acceptance-client-title"
                    value={form.clientTitle}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, clientTitle: event.target.value }))
                    }
                    disabled={disabled || busy}
                    placeholder="VP of Engineering"
                    autoComplete="organization-title"
                  />
                </div>
                <div>
                  <label
                    htmlFor="acceptance-client-email"
                    className="mb-1 block text-sm font-medium text-muted-foreground"
                  >
                    Email
                  </label>
                  <Input
                    id="acceptance-client-email"
                    type="email"
                    value={form.clientEmail}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, clientEmail: event.target.value }))
                    }
                    disabled={disabled || busy}
                    placeholder="jane@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>
            </div>

            {/* ---- Signature mode toggle ---- */}
            <div>
              <span className="mb-1 block text-sm font-medium">Signature</span>
              <div className="mb-2 flex gap-1 rounded-lg border bg-muted/30 p-0.5">
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => setForm((prev) => ({ ...prev, signatureMode: "typed" }))}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    form.signatureMode === "typed"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Type className="h-3.5 w-3.5" />
                  Typed
                </button>
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => setForm((prev) => ({ ...prev, signatureMode: "drawn" }))}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    form.signatureMode === "drawn"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <PenTool className="h-3.5 w-3.5" />
                  Draw
                </button>
              </div>
            </div>

            {/* ---- Signature input ---- */}
            {form.signatureMode === "typed" ? (
              <TypedSignature
                value={form.typedName}
                onChange={(value) => setForm((prev) => ({ ...prev, typedName: value }))}
                onSignature={handleTypedSignature}
                disabled={disabled || busy}
              />
            ) : (
              <SignatureCanvas
                onSignature={handleDrawnSignature}
                onClear={handleClearDrawn}
                disabled={disabled || busy}
              />
            )}

            {/* ---- Error ---- */}
            {error !== null && <p className="text-sm text-destructive">{error}</p>}

            {/* ---- Submit ---- */}
            <Button type="submit" disabled={!canSubmit} className="w-full" size="lg">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              {busy ? "Submitting…" : "Accept Proposal"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
