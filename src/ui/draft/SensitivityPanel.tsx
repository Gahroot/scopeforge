import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project, SensitivityInput, SensitivityResult } from "../../core/types.js";
import { Card, CardContent, CardTitle } from "../components/ui/card.js";
import { Button } from "../components/ui/button.js";
import { fetchSensitivity } from "../lib/api.js";
import type { SessionSnapshot } from "../lib/types.js";
import { SensitivitySlider } from "./SensitivitySlider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SensitivityParameter {
  readonly param: string;
  readonly label: string;
  readonly baseValue: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly format?: (value: number) => string;
}

export interface SensitivityPanelProps {
  readonly snapshot: SessionSnapshot;
}

// ---------------------------------------------------------------------------
// Parameter extraction
// ---------------------------------------------------------------------------

function extractParameters(project: Project): readonly SensitivityParameter[] {
  const params: SensitivityParameter[] = [];

  // Blended rate (likely)
  params.push({
    param: "cost.blendedRate.likely",
    label: "Blended rate ($/hr)",
    baseValue: project.cost.blendedRate.likely,
    min: 50,
    max: 350,
    step: 5,
    format: (v: number) => `$${v}`,
  });

  // Margin
  params.push({
    param: "cost.margin",
    label: "Margin",
    baseValue: project.cost.margin,
    min: 0.05,
    max: 0.6,
    step: 0.01,
    format: (v: number) => `${Math.round(v * 100)}%`,
  });

  // Per-workstream hours and AI factor
  for (const [i, ws] of project.cost.workstreams.entries()) {
    params.push({
      param: `cost.workstreams[${i}].hours.likely`,
      label: `Hours: ${ws.name}`,
      baseValue: ws.hours.likely,
      min: 2,
      max: 500,
      step: 1,
    });
    params.push({
      param: `cost.workstreams[${i}].aiFactor`,
      label: `AI factor: ${ws.name}`,
      baseValue: ws.aiFactor,
      min: 0.1,
      max: 1.0,
      step: 0.05,
      format: (v: number) => `${Math.round(v * 100)}%`,
    });
  }

  // Realization factor
  params.push({
    param: "value.realizationFactor.low",
    label: "Realization (low)",
    baseValue: project.value.realizationFactor.low,
    min: 0.1,
    max: 0.8,
    step: 0.01,
    format: (v: number) => `${Math.round(v * 100)}%`,
  });

  params.push({
    param: "value.realizationFactor.high",
    label: "Realization (high)",
    baseValue: project.value.realizationFactor.high,
    min: 0.2,
    max: 0.95,
    step: 0.01,
    format: (v: number) => `${Math.round(v * 100)}%`,
  });

  // Team size (headcount)
  params.push({
    param: "client.sizeHeadcount",
    label: "Team size",
    baseValue: project.client.sizeHeadcount,
    min: 1,
    max: 50,
    step: 1,
  });

  return params;
}

// ---------------------------------------------------------------------------
// Default sweep config
// ---------------------------------------------------------------------------

function buildSweepInput(param: string, currentValue: number): SensitivityInput {
  return {
    param,
    base: currentValue,
    min: currentValue * 0.5,
    max: currentValue * 2.0,
    steps: 11,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number | null): string {
  if (value === null) return "TBD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatRange(low: number, high: number): string {
  return `${formatMoney(low)} – ${formatMoney(high)}`;
}

// ---------------------------------------------------------------------------
// Price summary component
// ---------------------------------------------------------------------------

interface PriceSummaryProps {
  readonly result: SensitivityResult | null;
  readonly currentValue: number;
}

function PriceSummary({ result, currentValue }: PriceSummaryProps): JSX.Element {
  if (result === null) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
        Adjust a slider to see price impact.
      </div>
    );
  }

  // Find the closest point to the current value (runSensitivity guarantees steps >= 2)
  const firstPoint = result.points[0];
  if (firstPoint === undefined) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
        Adjust a slider to see price impact.
      </div>
    );
  }
  let closestPoint = firstPoint;
  let closestDist = Math.abs(closestPoint.paramValue - currentValue);
  for (const point of result.points) {
    const dist = Math.abs(point.paramValue - currentValue);
    if (dist < closestDist) {
      closestPoint = point;
      closestDist = dist;
    }
  }

  const base = result.baseAnalysis;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/50 p-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Cost floor (P50)
          </span>
          <p className="text-sm font-semibold tabular-nums">
            {formatMoney(closestPoint.priceFloor.p50)}
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 p-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Cost floor (P90)
          </span>
          <p className="text-sm font-semibold tabular-nums">
            {formatMoney(closestPoint.priceFloor.p90)}
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 p-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Target band
          </span>
          <p className="text-sm font-semibold tabular-nums">
            {formatRange(closestPoint.targetBand.low, closestPoint.targetBand.high)}
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 p-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Lead price
          </span>
          <p className="text-sm font-semibold tabular-nums">
            {closestPoint.leadPrice !== null ? formatMoney(closestPoint.leadPrice) : "—"}
          </p>
        </div>
      </div>

      {/* Base vs adjusted comparison */}
      {closestDist > 0.001 && (
        <div className="flex items-center gap-2 rounded-md bg-primary/5 px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">Base floor:</span>
          <span className="tabular-nums">{formatMoney(base.cost.priceFloor.p50)}</span>
          <span className="text-muted-foreground">→</span>
          <span className="tabular-nums font-medium">
            {formatMoney(closestPoint.priceFloor.p50)}
          </span>
          <span
            className={
              closestPoint.priceFloor.p50 > base.cost.priceFloor.p50
                ? "text-destructive"
                : "text-success"
            }
          >
            ({closestPoint.priceFloor.p50 > base.cost.priceFloor.p50 ? "+" : ""}
            {formatMoney(Math.abs(closestPoint.priceFloor.p50 - base.cost.priceFloor.p50))})
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function SensitivityPanel({ snapshot }: SensitivityPanelProps): JSX.Element {
  const { fullDraft } = snapshot;
  const project = fullDraft.project;

  const baseParams = useMemo(() => extractParameters(project), [project]);

  // Slider state: param → current value
  const [sliderValues, setSliderValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const p of baseParams) {
      initial[p.param] = p.baseValue;
    }
    return initial;
  });

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SensitivityResult | null>(null);
  const [activeParam, setActiveParam] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Check if any value differs from base
  const hasChanges = useMemo(() => {
    return baseParams.some((p) => {
      const current = sliderValues[p.param];
      return current !== undefined && Math.abs(current - p.baseValue) > 0.0001;
    });
  }, [baseParams, sliderValues]);

  // Fetch sensitivity when a slider changes (debounced)
  const requestSensitivity = useCallback(
    (param: string, value: number) => {
      if (debounceRef.current !== undefined) {
        clearTimeout(debounceRef.current);
      }

      setActiveParam(param);

      debounceRef.current = setTimeout(() => {
        const sweepInput = buildSweepInput(param, value);
        setLoading(true);

        // Abort any previous in-flight request
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        fetchSensitivity({ project, sensitivity: sweepInput }, controller.signal)
          .then((response) => {
            if (!controller.signal.aborted && response.ok) {
              setResult(response.value.result);
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) {
              setLoading(false);
            }
          });
      }, 150);
    },
    [project],
  );

  const handleSliderChange = useCallback(
    (param: string, value: number): void => {
      setSliderValues((prev) => ({ ...prev, [param]: value }));
      requestSensitivity(param, value);
    },
    [requestSensitivity],
  );

  const handleReset = useCallback((): void => {
    const initial: Record<string, number> = {};
    for (const p of baseParams) {
      initial[p.param] = p.baseValue;
    }
    setSliderValues(initial);
    setResult(null);
    setActiveParam(null);
  }, [baseParams]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current !== undefined) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <Card>
      <button
        type="button"
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-muted/30"
        onClick={() => setOpen((prev) => !prev)}
      >
        <CardTitle className="flex items-center gap-2 text-sm">
          <SlidersHorizontal className="h-4 w-4" />
          Pricing sensitivity
          {loading && (
            <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          )}
        </CardTitle>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <CardContent className="space-y-4 border-t pt-4">
          {/* Price summary */}
          <PriceSummary
            result={result}
            currentValue={activeParam !== null ? (sliderValues[activeParam] ?? 0) : 0}
          />

          {/* Sliders */}
          <div className="space-y-4">
            {baseParams.map((param) => (
              <SensitivitySlider
                key={param.param}
                label={param.label}
                value={sliderValues[param.param] ?? param.baseValue}
                baseValue={param.baseValue}
                min={param.min}
                max={param.max}
                {...(param.step === undefined ? {} : { step: param.step })}
                {...(param.format === undefined ? {} : { format: param.format })}
                onChange={(value) => handleSliderChange(param.param, value)}
              />
            ))}
          </div>

          {/* Reset button */}
          {hasChanges && (
            <Button variant="outline" size="sm" className="w-full" onClick={handleReset}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to base
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
