import { useCallback, useRef } from "react";
import { Input } from "../components/ui/input.js";
import { cn } from "../lib/utils.js";

export interface TypedSignatureProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSignature: (dataUrl: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
}

const CURSIVE_FONT =
  "'Brush Script MT', 'Segoe Script', 'Snell Roundhand', 'Apple Chancery', cursive";

export function TypedSignature({
  value,
  onChange,
  onSignature,
  disabled = false,
  placeholder = "Type your full name",
  className,
}: TypedSignatureProps): JSX.Element {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const newValue = event.target.value;
      onChange(newValue);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (newValue.trim().length > 0) {
          const dataUrl = renderTypedSignature(newValue);
          onSignature(dataUrl);
        }
      }, 300);
    },
    [onChange, onSignature],
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Input
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Type your signature"
        className="border-dashed border-muted-foreground/40"
        style={{
          fontFamily: CURSIVE_FONT,
          fontSize: "1.5rem",
          height: "3.5rem",
          textAlign: "center",
          letterSpacing: "0.02em",
        }}
      />
      {value.trim().length > 0 && (
        <div
          role="img"
          className="flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-white py-6"
          aria-label="Signature preview"
        >
          <span
            style={{
              fontFamily: CURSIVE_FONT,
              fontSize: "2rem",
              color: "#1a1a2e",
              lineHeight: 1,
            }}
          >
            {value}
          </span>
        </div>
      )}
    </div>
  );
}

function renderTypedSignature(name: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "italic 48px 'Brush Script MT', 'Segoe Script', cursive";
  ctx.fillStyle = "#1a1a2e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL("image/png");
}
