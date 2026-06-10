import { useCallback, useState } from "react";
import { Palette, Upload, X } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { BUILT_IN_STYLE_PRESET_IDS, getBuiltInStylePresets } from "../../proposal/presets.js";

export interface StylePresetSelectorProps {
  readonly selectedPresetId?: string | undefined;
  readonly disabled?: boolean;
  readonly onPresetChange: (presetId: string | null) => void;
  readonly onUploadReference?: ((file: File) => void) | undefined;
  readonly extracting?: boolean | undefined;
}

export function StylePresetSelector({
  selectedPresetId,
  disabled = false,
  onPresetChange,
  onUploadReference,
  extracting = false,
}: StylePresetSelectorProps): JSX.Element {
  const [showUpload, setShowUpload] = useState(false);
  const presets = getBuiltInStylePresets();
  const isBuiltIn =
    selectedPresetId !== undefined &&
    (BUILT_IN_STYLE_PRESET_IDS as readonly string[]).includes(selectedPresetId);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      if (value === "" || value === "default") {
        onPresetChange(null);
      } else {
        onPresetChange(value);
      }
    },
    [onPresetChange],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file !== undefined && onUploadReference !== undefined) {
        onUploadReference(file);
        setShowUpload(false);
      }
      // Reset the input so the same file can be re-selected
      event.target.value = "";
    },
    [onUploadReference],
  );

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Palette className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">Style:</span>
      <select
        value={selectedPresetId ?? "default"}
        onChange={handleChange}
        disabled={disabled}
        className="h-7 rounded-md border bg-background px-2 text-xs shadow-sm"
        aria-label="Proposal style preset"
      >
        <option value="default">Triten (default)</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      {onUploadReference !== undefined && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={disabled || extracting}
            onClick={() => setShowUpload(!showUpload)}
          >
            <Upload className="mr-1 h-3 w-3" />
            {extracting ? "Extracting..." : "Reference PDF"}
          </Button>
          {showUpload && (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-1 font-medium shadow-sm transition-colors hover:bg-accent">
              <Upload className="h-3 w-3" />
              Choose PDF
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
          )}
        </>
      )}
      {selectedPresetId !== undefined && selectedPresetId !== "default" && !isBuiltIn && (
        <button
          type="button"
          onClick={() => onPresetChange(null)}
          disabled={disabled}
          className="rounded-sm p-0.5 hover:bg-background"
          aria-label="Clear custom style preset"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
