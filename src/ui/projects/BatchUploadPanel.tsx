import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, UploadCloud, X, XCircle } from "lucide-react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Separator } from "../components/ui/separator.js";
import {
  submitBatchJob,
  fetchBatchJobStatus,
  cancelBatchJob,
  type BatchJobItem,
  type BatchJobStatusResponse,
} from "../lib/api.js";

const ACCEPTED_FILE_TYPES = [
  ".txt",
  ".text",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/pdf",
].join(",");

const POLL_INTERVAL_MS = 2_000;

export interface BatchUploadPanelProps {
  readonly onJobCreated?: (jobId: string) => void;
}

export function BatchUploadPanel({ onJobCreated }: BatchUploadPanelProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<readonly File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active job state
  const [activeJob, setActiveJob] = useState<BatchJobStatusResponse | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const pollRef = useRef<number | null>(null);

  const completedCount = activeJob?.completedCount ?? 0;
  const failedCount = activeJob?.failedCount ?? 0;
  const itemCount = activeJob?.itemCount ?? 0;
  const progressPercent =
    itemCount > 0 ? Math.round(((completedCount + failedCount) / itemCount) * 100) : 0;

  const isActive =
    activeJob !== null && (activeJob.status === "pending" || activeJob.status === "processing");

  // Poll active job status
  const activeJobId = activeJob?.jobId ?? null;
  useEffect(() => {
    if (activeJobId === null || !isActive) return;

    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      const result = await fetchBatchJobStatus(activeJobId, controller.signal);
      if (!controller.signal.aborted && result.ok) {
        setActiveJob(result.value);
      }
    };

    void poll();
    pollRef.current = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(pollRef.current ?? undefined);
      pollRef.current = null;
      controller.abort();
    };
  }, [activeJobId, isActive]);

  const addFiles = useCallback((incoming: FileList | readonly File[]): void => {
    setError(null);
    const incomingArray = Array.from(incoming);
    setFiles((current) => {
      const existing = new Set(current.map((f) => `${f.name}:${f.size}`));
      const deduped = incomingArray.filter((f) => !existing.has(`${f.name}:${f.size}`));
      return [...current, ...deduped];
    });
  }, []);

  const removeFile = useCallback((index: number): void => {
    setFiles((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      if (event.dataTransfer.files.length > 0) {
        addFiles(event.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitBatchJob(files);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const initialStatus: BatchJobStatusResponse = {
        ok: true,
        jobId: result.value.jobId,
        status: "pending",
        itemCount: result.value.itemCount,
        completedCount: 0,
        failedCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: files.map((file, index) => ({
          itemId: `item-${index}`,
          fileName: file.name,
          status: "pending" as const,
        })),
      };
      setActiveJob(initialStatus);
      setFiles([]);
      onJobCreated?.(result.value.jobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [files, onJobCreated]);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (activeJob === null) return;
    setCancelling(true);
    try {
      const result = await cancelBatchJob(activeJob.jobId);
      if (result.ok) {
        setActiveJob((current) => (current === null ? null : { ...current, status: "cancelled" }));
      } else {
        setError(result.error.message);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCancelling(false);
    }
  }, [activeJob]);

  const handleDismiss = useCallback((): void => {
    setActiveJob(null);
    setError(null);
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Batch Upload</CardTitle>
          </div>
          {activeJob !== null && (
            <Badge
              variant={
                activeJob.status === "completed"
                  ? "success"
                  : activeJob.status === "failed"
                    ? "destructive"
                    : activeJob.status === "cancelled"
                      ? "outline"
                      : "secondary"
              }
            >
              {activeJob.status}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error !== null && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Drop zone */}
        {!isActive && (
          <button
            type="button"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              dragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
          >
            <UploadCloud className="h-8 w-8 text-muted-foreground" />
            <span className="text-sm font-medium">
              Drop intake documents here or click to browse
            </span>
            <span className="text-xs text-muted-foreground">
              Accepts text, markdown, JSON, CSV, and PDF files
            </span>
          </button>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          className="sr-only"
          onChange={(event) => {
            if (event.target.files !== null && event.target.files.length > 0) {
              addFiles(event.target.files);
            }
            event.target.value = "";
          }}
        />

        {/* File list */}
        {files.length > 0 && !isActive && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {files.length} file{files.length === 1 ? "" : "s"} selected
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {files.map((file, index) => (
                  <div
                    key={`${file.name}:${file.size}`}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-xs">{file.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      disabled={busy}
                      className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <Button className="w-full" onClick={() => void handleSubmit()} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              Generate Proposals
            </Button>
          </>
        )}

        {/* Active job progress */}
        {isActive && activeJob !== null && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {completedCount} of {itemCount} completed
                  {failedCount > 0 ? ` · ${failedCount} failed` : ""}
                </span>
                <span className="font-medium">{progressPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {activeJob.items.map((item) => (
                  <BatchItemRow key={item.itemId} item={item} />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void handleCancel()}
                disabled={cancelling}
              >
                {cancelling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* Completed job summary */}
        {activeJob !== null && !isActive && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Job {activeJob.jobId.slice(0, 8)}… · {activeJob.completedCount} succeeded
                {activeJob.failedCount > 0 ? ` · ${activeJob.failedCount} failed` : ""}
              </p>
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                Dismiss
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface BatchItemRowProps {
  readonly item: BatchJobItem;
}

function BatchItemRow({ item }: BatchItemRowProps): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/30 px-2.5 py-1.5">
      {item.status === "completed" ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
      ) : item.status === "failed" ? (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      )}
      <span className="min-w-0 truncate text-xs">{item.fileName}</span>
      {item.error !== undefined && (
        <span className="ml-auto shrink-0 text-[10px] text-destructive" title={item.error}>
          Error
        </span>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} bytes`;
}
