import { useCallback, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Textarea } from "../components/ui/textarea.js";
import type { ProposalDraft } from "../../proposal/types.js";
import { saveTemplateAs, type SaveTemplateInput, type TemplateCategory } from "../lib/api.js";

const CATEGORIES: readonly TemplateCategory[] = [
  "SaaS",
  "Mobile",
  "Automation",
  "Consulting",
  "Custom",
];

export interface SaveTemplateDialogProps {
  readonly open: boolean;
  readonly draft: ProposalDraft | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function SaveTemplateDialog({
  open,
  draft,
  onClose,
  onSaved,
}: SaveTemplateDialogProps): JSX.Element | null {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("Custom");
  const [tagsInput, setTagsInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setCategory("Custom");
    setTagsInput("");
    setMessage(null);
    setSaved(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSave = useCallback(async () => {
    if (draft === null || name.trim().length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      const input: SaveTemplateInput = {
        name: name.trim(),
        category,
        tags,
        draft,
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      };
      const result = await saveTemplateAs(input);
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setSaved(true);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [draft, name, description, category, tagsInput, onSaved]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Save as Template</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Save your current draft as a reusable proposal template.
        </p>

        {saved ? (
          <div className="mt-6 flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="text-sm font-medium">Template saved successfully!</p>
            <Button type="button" onClick={handleClose}>
              Done
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="grid gap-1 text-sm" htmlFor="save-template-name">
              Name <span className="text-destructive">*</span>
              <Input
                id="save-template-name"
                value={name}
                placeholder="e.g. SaaS Onboarding Proposal"
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm" htmlFor="save-template-description">
              Description
              <Textarea
                id="save-template-description"
                value={description}
                placeholder="Brief description of what this template is for"
                disabled={busy}
                rows={2}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Category
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={category}
                disabled={busy}
                onChange={(event) => setCategory(event.target.value as TemplateCategory)}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm" htmlFor="save-template-tags">
              Tags
              <Input
                id="save-template-tags"
                value={tagsInput}
                placeholder="comma-separated, e.g. onboarding, b2b, saas"
                disabled={busy}
                onChange={(event) => setTagsInput(event.target.value)}
              />
            </label>

            {message !== null && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {message}
              </p>
            )}

            {draft === null && (
              <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                No draft content available. Start a proposal first before saving as template.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || name.trim().length === 0 || draft === null}
                onClick={() => void handleSave()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save Template
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
