import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils.js";
import { MarkdownContent } from "./MarkdownContent.js";

export interface ThinkingBlockProps {
  readonly content: string;
  readonly thinkingLevel?: string;
}

export function ThinkingBlock({ content, thinkingLevel }: ThinkingBlockProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        <span>🧠 Thinking{thinkingLevel !== undefined ? ` (${thinkingLevel})` : ""}…</span>
      </button>
      {expanded && (
        <div className="border-t border-border/50 px-3 py-2">
          <div className="font-mono text-xs leading-relaxed text-muted-foreground">
            <MarkdownContent content={content} />
          </div>
        </div>
      )}
    </div>
  );
}
