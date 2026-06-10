import { useEffect, useState } from "react";
import { X } from "lucide-react";

export interface ImagePreviewProps {
  readonly file: File;
  readonly disabled?: boolean;
  readonly onRemove: () => void;
}

export function ImagePreview({ file, disabled = false, onRemove }: ImagePreviewProps): JSX.Element {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-1.5">
      {objectUrl !== null && (
        <img
          src={objectUrl}
          alt={`Preview of ${file.name}`}
          className="h-10 w-10 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{file.name}</p>
        <p className="text-[11px] text-muted-foreground">{formatFileSize(file.size)}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="rounded-sm p-0.5 hover:bg-background"
        aria-label="Remove image"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} bytes`;
}
