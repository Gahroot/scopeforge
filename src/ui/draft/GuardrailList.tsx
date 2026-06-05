import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import type { ValidationSnapshot } from "../lib/types.js";
import { cn } from "../lib/utils.js";

export interface GuardrailListProps {
  readonly validation: ValidationSnapshot;
}

export function GuardrailList({ validation }: GuardrailListProps): JSX.Element {
  const hasErrors = !validation.ok || validation.blocking.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {hasErrors ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          Validation & guardrails
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!validation.ok && (
          <ul className="space-y-1">
            {validation.errors.slice(0, 6).map((issue) => (
              <li key={issue.path} className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-mono opacity-70">{issue.path}</span> {issue.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        {validation.guardrails.length === 0 && validation.ok && (
          <p className="text-xs text-muted-foreground">No guardrail issues. Draft is ready.</p>
        )}

        <ul className="space-y-1">
          {validation.guardrails.map((warning) => (
            <li
              key={`${warning.rule}-${warning.message}`}
              className={cn(
                "flex items-start gap-1.5 text-xs",
                warning.severity === "error"
                  ? "text-destructive"
                  : warning.severity === "warning"
                    ? "text-warning"
                    : "text-muted-foreground",
              )}
            >
              {warning.severity === "error" ? (
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : warning.severity === "warning" ? (
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
