import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { Textarea } from "../components/ui/textarea.js";

export interface ComposerProps {
  readonly onSend: (message: string) => void;
  readonly onStop: () => void;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly placeholder?: string;
}

export function Composer({
  onSend,
  onStop,
  busy,
  disabled = false,
  placeholder,
}: ComposerProps): JSX.Element {
  const [value, setValue] = useState("");

  function submit(): void {
    const trimmed = value.trim();
    if (trimmed.length === 0 || busy || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t bg-background p-3">
      <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={placeholder ?? "Describe the build, or answer the question…"}
          className="max-h-40 min-h-[40px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        {busy ? (
          <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="Stop">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={disabled || value.trim().length === 0}
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
