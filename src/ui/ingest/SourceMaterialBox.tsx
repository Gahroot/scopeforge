import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { FileUp, Loader2, NotebookTabs, X } from "lucide-react";
import {
  MAX_SOURCE_MATERIAL_AGENT_PROMPT_CHARS,
  MAX_SOURCE_MATERIAL_FILE_BYTES,
  MAX_SOURCE_MATERIAL_TEXT_CHARS,
} from "../../ingest/limits.js";
import type { SourceMaterialKind } from "../../ingest/types.js";
import { ingestSourceMaterial, type SourceMaterialIngestResponse } from "../lib/api.js";
import { Button } from "../components/ui/button.js";
import { Textarea } from "../components/ui/textarea.js";
import { cn } from "../lib/utils.js";

export interface SourceMaterialBoxProps {
  readonly disabled?: boolean;
  readonly onIngested: (response: SourceMaterialIngestResponse) => void;
}

const ACCEPTED_SOURCE_TYPES = [
  ".txt",
  ".text",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "application/pdf",
].join(",");

const SOURCE_KIND_OPTIONS: readonly {
  readonly value: SourceMaterialKind;
  readonly label: string;
}[] = [
  { value: "meeting_notes", label: "Meeting notes" },
  { value: "transcript_summary", label: "Transcript summary" },
  { value: "text", label: "Plain text" },
  { value: "json", label: "JSON" },
  { value: "pdf", label: "PDF text" },
];

export function SourceMaterialBox({
  disabled = false,
  onIngested,
}: SourceMaterialBoxProps): JSX.Element {
  const fileInputId = useId();
  const [sourceKind, setSourceKind] = useState<SourceMaterialKind>("meeting_notes");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const hasText = text.trim().length > 0;
  const canSubmit = !disabled && !busy && (hasText || file !== null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await ingestSourceMaterial(
        file === null
          ? {
              sourceKind,
              text,
              sourceName: sourceKindLabel(sourceKind),
            }
          : {
              sourceKind,
              file: {
                name: file.name,
                ...(file.type.length === 0 ? {} : { mediaType: file.type }),
                base64: await fileToBase64(file),
              },
            },
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setStatus(
        `${result.value.candidate.summary} Sending it to the copilot so it can apply safe fields and ask for missing inputs.`,
      );
      onIngested(result.value);
      setText("");
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setError(null);
    setStatus(null);
    const selected = event.target.files?.[0] ?? null;
    if (selected !== null && selected.size > MAX_SOURCE_MATERIAL_FILE_BYTES) {
      setError(`Source files must be ${formatBytes(MAX_SOURCE_MATERIAL_FILE_BYTES)} or smaller.`);
      setFile(null);
      event.target.value = "";
      return;
    }
    setFile(selected);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="border-b bg-muted/20 p-3">
      <div className="mx-auto max-w-2xl rounded-xl border bg-card p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <NotebookTabs className="h-4 w-4 text-muted-foreground" />
            <span>Source material</span>
          </div>
          <select
            value={sourceKind}
            onChange={(event) => setSourceKind(event.target.value as SourceMaterialKind)}
            disabled={disabled || busy}
            className="h-8 rounded-md border bg-background px-2 text-xs text-muted-foreground shadow-sm"
            aria-label="Source material type"
          >
            {SOURCE_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value.trim().length > 0) setFile(null);
          }}
          disabled={disabled || busy || file !== null}
          rows={3}
          maxLength={MAX_SOURCE_MATERIAL_TEXT_CHARS}
          placeholder="Paste notes, a transcript summary, or a text/JSON excerpt. I’ll extract facts and list what’s still missing."
          className="min-h-[84px] resize-none"
        />

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <label
              htmlFor={fileInputId}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 font-medium shadow-sm transition-colors hover:bg-accent",
                (disabled || busy || hasText) && "pointer-events-none opacity-50",
              )}
            >
              <FileUp className="h-3.5 w-3.5" />
              Upload text / JSON / PDF
            </label>
            <input
              id={fileInputId}
              type="file"
              accept={ACCEPTED_SOURCE_TYPES}
              className="sr-only"
              disabled={disabled || busy || hasText}
              onChange={handleFileChange}
            />
            {file !== null && (
              <span className="flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  disabled={busy}
                  className="rounded-sm p-0.5 hover:bg-background"
                  aria-label="Remove uploaded source file"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>

          <Button type="submit" size="sm" disabled={!canSubmit}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Ingest
          </Button>
        </div>

        {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}
        {status !== null && <p className="mt-2 text-xs text-muted-foreground">{status}</p>}
      </div>
    </form>
  );
}

export function buildSourceMaterialAgentPrompt(response: SourceMaterialIngestResponse): string {
  const warnings = response.document.warnings;
  const missing = response.candidate.missingInputs
    .map((input, index) => `${index + 1}. ${input.label}`)
    .join("\n");
  const textForPrompt = trimForAgentPrompt(response.document.text);
  return [
    "I added source material. Call ingest_source_material with applySafePatch=true using the extracted text below.",
    "After the tool result, summarize the candidate and ask only for the next missing cost/value/pricing facts. Do not run analysis until those are confirmed.",
    "",
    `Source: ${response.document.metadata.sourceName} (${response.document.metadata.kind}, ${response.document.metadata.characterLength} chars).`,
    warnings.length === 0
      ? "Extraction warnings: none."
      : `Extraction warnings: ${warnings.join("; ")}`,
    missing.length === 0
      ? "Route candidate missing inputs: none."
      : `Route candidate missing inputs:\n${missing}`,
    "",
    "--- EXTRACTED SOURCE MATERIAL ---",
    textForPrompt,
  ].join("\n");
}

function sourceKindLabel(kind: SourceMaterialKind): string {
  switch (kind) {
    case "meeting_notes":
      return "Meeting notes";
    case "transcript_summary":
      return "Transcript summary";
    case "text":
      return "Plain text source material";
    case "json":
      return "JSON source material";
    case "pdf":
      return "PDF source material";
    case "image":
      return "Image source material";
  }
}

function trimForAgentPrompt(input: string): string {
  if (input.length <= MAX_SOURCE_MATERIAL_AGENT_PROMPT_CHARS) return input;
  return `${input.slice(0, MAX_SOURCE_MATERIAL_AGENT_PROMPT_CHARS).trim()}\n\n[Truncated for the agent prompt; server-side extraction already recorded the limit.]`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} bytes`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.onerror = () =>
      rejectPromise(reader.error ?? new Error("Could not read the selected file."));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        rejectPromise(new Error("Could not read the selected file as bytes."));
        return;
      }
      resolvePromise(bytesToBase64(new Uint8Array(reader.result)));
    };
    reader.readAsArrayBuffer(file);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
