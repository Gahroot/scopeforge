import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Skeleton } from "../components/ui/skeleton.js";
import type { EconomicsSnapshot } from "../lib/types.js";

export interface PriceCardProps {
  readonly economics: EconomicsSnapshot | null;
}

interface MetricProps {
  readonly label: string;
  readonly value: string;
  readonly emphasize?: boolean;
}

function Metric({ label, value, emphasize = false }: MetricProps): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={emphasize ? "text-lg font-semibold" : "text-sm font-medium"}>{value}</span>
    </div>
  );
}

export function PriceCard({ economics }: PriceCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Economics</CardTitle>
      </CardHeader>
      <CardContent>
        {economics === null ? (
          <div className="space-y-2">
            <Skeleton className="h-7 w-32" />
            <p className="text-xs text-muted-foreground">
              Add cost workstreams and pricing to compute the deterministic price, value, and
              payback.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Metric label="Lead price" value={economics.formattedLeadPrice} emphasize />
            <Metric label="Payback" value={economics.paybackMonths} emphasize />
            <Metric label="Year-one value" value={economics.yearOneValueRange} />
            <Metric label="Target price band" value={economics.targetPriceRange} />
            <Metric label="Future upside" value={economics.futureUpsideRange} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
