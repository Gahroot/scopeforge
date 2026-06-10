import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Separator } from "../components/ui/separator.js";
import { fetchBatchJobResults, type BatchJobResultItem, type BatchJobResults } from "../lib/api.js";

export interface BatchResultsProps {
  readonly jobId: string;
  readonly onOpenProject?: (projectId: string) => void;
  readonly onBack?: () => void;
}

export function BatchResults({ jobId, onOpenProject, onBack }: BatchResultsProps): JSX.Element {
  const [results, setResults] = useState<BatchJobResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchBatchJobResults(jobId, controller.signal);
        if (controller.signal.aborted) return;
        if (response.ok) {
          setResults(response.value);
        } else {
          setError(response.error.message);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [jobId]);

  const successfulItems = results?.results.filter((item) => item.status === "completed") ?? [];
  const failedItems = results?.results.filter((item) => item.status === "failed") ?? [];

  const handleOpenAll = useCallback((): void => {
    if (onOpenProject === undefined) return;
    for (const item of successfulItems) {
      if (item.projectId !== undefined) {
        onOpenProject(item.projectId);
      }
    }
  }, [successfulItems, onOpenProject]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {onBack !== undefined && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onBack}>
                ← Back
              </Button>
            )}
            <CardTitle className="text-base">Batch Results</CardTitle>
          </div>
          {results !== null && (
            <div className="flex items-center gap-2">
              {successfulItems.length > 0 && (
                <Badge variant="success">{successfulItems.length} succeeded</Badge>
              )}
              {failedItems.length > 0 && (
                <Badge variant="destructive">{failedItems.length} failed</Badge>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading results…
          </div>
        )}

        {error !== null && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!loading &&
          results !== null &&
          (results.results.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm font-medium">No results found.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This batch job may not have completed yet.
              </p>
            </div>
          ) : (
            <>
              {/* Successful proposals */}
              {successfulItems.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Generated Proposals</p>
                  {successfulItems.map((item) => (
                    <ResultItemRow
                      key={item.itemId}
                      item={item}
                      {...(onOpenProject !== undefined ? { onOpenProject } : {})}
                    />
                  ))}
                </div>
              )}

              {successfulItems.length > 0 && failedItems.length > 0 && <Separator />}

              {/* Failed items */}
              {failedItems.length > 0 && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <AlertTriangle className="h-3 w-3" />
                    Failed Items
                  </p>
                  {failedItems.map((item) => (
                    <FailedItemRow key={item.itemId} item={item} />
                  ))}
                </div>
              )}

              {successfulItems.length > 1 && onOpenProject !== undefined && (
                <Button variant="outline" className="w-full" onClick={handleOpenAll}>
                  <FolderOpen className="h-4 w-4" />
                  Open All
                </Button>
              )}
            </>
          ))}
      </CardContent>
    </Card>
  );
}

interface ResultItemRowProps {
  readonly item: BatchJobResultItem;
  readonly onOpenProject?: (projectId: string) => void;
}

function ResultItemRow({ item, onOpenProject }: ResultItemRowProps): JSX.Element {
  const projectId = item.projectId;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
      <div className="flex min-w-0 items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.projectTitle ?? item.fileName}</p>
          {item.projectTitle !== undefined && item.projectTitle !== item.fileName && (
            <p className="truncate text-xs text-muted-foreground">{item.fileName}</p>
          )}
        </div>
      </div>
      {projectId !== undefined && onOpenProject !== undefined && (
        <Button variant="outline" size="sm" onClick={() => onOpenProject(projectId)}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </Button>
      )}
    </div>
  );
}

interface FailedItemRowProps {
  readonly item: BatchJobResultItem;
}

function FailedItemRow({ item }: FailedItemRowProps): JSX.Element {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
      <div className="flex items-center gap-2">
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="truncate text-sm font-medium">{item.fileName}</span>
      </div>
      {item.error !== undefined && (
        <p className="mt-1 ml-6 text-xs text-destructive/80">{item.error}</p>
      )}
    </div>
  );
}
