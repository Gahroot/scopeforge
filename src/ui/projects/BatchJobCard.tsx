import { useCallback, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Separator } from "../components/ui/separator.js";
import type { BatchJobStatusResponse } from "../lib/api.js";

export interface BatchJobCardProps {
  readonly job: BatchJobStatusResponse;
  readonly onViewResults: (jobId: string) => void;
}

export function BatchJobCard({ job, onViewResults }: BatchJobCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = useCallback((): void => {
    setExpanded((current) => !current);
  }, []);

  const isTerminal =
    job.status === "completed" || job.status === "failed" || job.status === "cancelled";

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleExpanded}
            className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Batch Job</CardTitle>
              <Badge
                variant={
                  job.status === "completed"
                    ? "success"
                    : job.status === "failed"
                      ? "destructive"
                      : job.status === "cancelled"
                        ? "outline"
                        : "secondary"
                }
              >
                {job.status}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {job.jobId.slice(0, 8)}… · {job.itemCount} item{job.itemCount === 1 ? "" : "s"} ·{" "}
              {formatRelativeTime(job.createdAt)}
            </p>
          </div>
          {isTerminal && job.status === "completed" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onViewResults(job.jobId)}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              View Results
            </Button>
          )}
        </div>
      </CardHeader>

      {expanded && (
        <>
          <Separator />
          <CardContent className="pt-3">
            <div className="space-y-1">
              {job.items.map((item) => (
                <div
                  key={item.itemId}
                  className="flex items-center gap-2 rounded-md bg-muted/30 px-2.5 py-1.5"
                >
                  {item.status === "completed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                  ) : item.status === "failed" ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-xs">{item.fileName}</span>
                  {item.error !== undefined && (
                    <span
                      className="ml-auto shrink-0 text-[10px] text-destructive"
                      title={item.error}
                    >
                      {item.error.length > 40 ? `${item.error.slice(0, 40)}…` : item.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {!isTerminal && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Processing… {job.completedCount}/{job.itemCount} completed
              </div>
            )}
          </CardContent>
        </>
      )}
    </Card>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.valueOf())) return isoString;
  const now = Date.now();
  const diffMs = now - date.valueOf();
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
