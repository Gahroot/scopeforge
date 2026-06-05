import { Check, Loader2, X } from "lucide-react";
import type { ToolActivityItem } from "./useAgentStream.js";
import { cn } from "../lib/utils.js";

export interface ToolActivityProps {
  readonly tools: readonly ToolActivityItem[];
}

export function ToolActivity({ tools }: ToolActivityProps): JSX.Element | null {
  if (tools.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tools.map((tool) => (
        <span
          key={tool.toolCallId}
          title={tool.summary}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
            tool.isError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : tool.done
                ? "border-success/30 bg-success/10 text-success"
                : "border-border bg-muted text-muted-foreground",
          )}
        >
          {tool.isError ? (
            <X className="h-3 w-3" />
          ) : tool.done ? (
            <Check className="h-3 w-3" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          {tool.label}
        </span>
      ))}
    </div>
  );
}
