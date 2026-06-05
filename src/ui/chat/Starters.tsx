import { ArrowUpRight } from "lucide-react";
import { cn } from "../lib/utils.js";

const STARTERS: readonly string[] = [
  "Draft a proposal for an AI ops pilot for a 45-person real-estate firm.",
  "Help me scope a data-pipeline + reporting build and price it honestly.",
  "I have a $40k pilot in mind — walk me through what you need.",
  "Turn this rough idea into a defensible scope: automate investor reporting.",
];

export interface StartersProps {
  readonly onPick: (prompt: string) => void;
  readonly disabled?: boolean;
}

export function Starters({ onPick, disabled = false }: StartersProps): JSX.Element {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-6 py-12 text-center">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Let's scope your proposal</h2>
        <p className="text-sm text-muted-foreground">
          Describe the build. I'll ask for the few facts the engine needs, then compute an honest
          price, year-one value, and payback.
        </p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {STARTERS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className={cn(
              "group flex items-start gap-2 rounded-lg border bg-card p-3 text-left text-sm shadow-sm transition-colors hover:border-primary/40 hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <span className="flex-1">{prompt}</span>
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          </button>
        ))}
      </div>
    </div>
  );
}
