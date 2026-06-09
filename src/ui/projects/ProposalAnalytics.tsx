import { useCallback, useEffect, useState } from "react";
import { BarChart3, Eye, Loader2, RefreshCw, Users } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { fetchProposalAnalytics, type AnalyticsData } from "../lib/api.js";

export interface ProposalAnalyticsProps {
  readonly projectId: string;
}

export function ProposalAnalytics({ projectId }: ProposalAnalyticsProps): JSX.Element {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchProposalAnalytics(projectId, signal);
        if (!signal?.aborted) {
          if (result.ok) setData(result.value);
          else setError(result.error.message);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4" />
          Engagement analytics
        </span>
        <Button variant="ghost" size="sm" className="h-7 px-2" disabled={loading} onClick={() => void load()}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      {error !== null && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {loading && data === null ? (
        <p className="text-xs text-muted-foreground">Loading analytics…</p>
      ) : data === null ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <div className="space-y-4">
          <SummaryRow data={data} />
          <SectionEngagementBarChart sections={data.sectionEngagement} />
          <PricingFocusCount count={data.pricingFocusCount} />
          <LastViewed time={data.lastViewed} />
        </div>
      )}
    </div>
  );
}

function SummaryRow({ data }: { readonly data: AnalyticsData }): JSX.Element {
  return (
    <div className="flex gap-4 text-sm">
      <div className="flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{data.views}</span>
        <span className="text-muted-foreground">views</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{data.uniqueViewers}</span>
        <span className="text-muted-foreground">unique</span>
      </div>
    </div>
  );
}

function SectionEngagementBarChart({
  sections,
}: {
  readonly sections: Readonly<Record<string, number>>;
}): JSX.Element | null {
  const entries = Object.entries(sections);
  if (entries.length === 0) return null;

  const maxCount = Math.max(...entries.map(([, count]) => count), 1);

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Section engagement</p>
      {entries.map(([section, count]) => (
        <div key={section} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate text-muted-foreground">{section}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(count / maxCount) * 100}%` }}
            />
          </div>
          <span className="w-6 text-right tabular-nums text-muted-foreground">{count}</span>
        </div>
      ))}
    </div>
  );
}

function PricingFocusCount({ count }: { readonly count: number }): JSX.Element {
  return (
    <div className="text-xs text-muted-foreground">
      Pricing section focused: <span className="font-medium text-foreground">{count}</span> time
      {count === 1 ? "" : "s"}
    </div>
  );
}

function LastViewed({ time }: { readonly time: string | null }): JSX.Element {
  if (time === null) {
    return <p className="text-xs text-muted-foreground">Not viewed yet.</p>;
  }
  const date = new Date(time);
  const formatted = Number.isNaN(date.valueOf())
    ? time
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
  return (
    <p className="text-xs text-muted-foreground">
      Last viewed: <span className="text-foreground">{formatted}</span>
    </p>
  );
}
