import { useCallback, useEffect, useMemo, useState } from "react";
import { Grid3X3, Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ScrollArea } from "../components/ui/scroll-area.js";
import type { ProposalDraft } from "../../proposal/types.js";
import {
  deleteTemplate,
  fetchTemplates,
  type TemplateCategory,
  type TemplateListItem,
} from "../lib/api.js";
import { TemplateCard } from "./TemplateCard.js";
import { SaveTemplateDialog } from "./SaveTemplateDialog.js";

const ALL_CATEGORIES: readonly TemplateCategory[] = [
  "SaaS",
  "Mobile",
  "Automation",
  "Consulting",
  "General",
  "Internal",
  "Executive",
  "Custom",
];

export interface TemplateGalleryProps {
  readonly open: boolean;
  readonly currentDraft: ProposalDraft | null;
  readonly onClose: () => void;
  readonly onUseTemplate: (templateId: string) => void;
}

export function TemplateGallery({
  open,
  currentDraft,
  onClose,
  onUseTemplate,
}: TemplateGalleryProps): JSX.Element | null {
  const [templates, setTemplates] = useState<readonly TemplateListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | null>(null);
  const [usingTemplateId, setUsingTemplateId] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const loadTemplates = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTemplates();
      if (result.ok) {
        setTemplates(result.value.templates);
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadTemplates();
  }, [open, loadTemplates]);

  const filteredTemplates = useMemo(() => {
    let result = templates;
    if (activeCategory !== null) {
      result = result.filter((t) => t.category === activeCategory);
    }
    if (searchQuery.trim().length > 0) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query) ||
          t.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }
    return result;
  }, [templates, activeCategory, searchQuery]);

  const handleUseTemplate = useCallback(
    (templateId: string) => {
      setUsingTemplateId(templateId);
      onUseTemplate(templateId);
    },
    [onUseTemplate],
  );

  const handleDeleteTemplate = useCallback(async (templateId: string): Promise<void> => {
    try {
      const result = await deleteTemplate(templateId);
      if (result.ok) {
        setTemplates((prev) => prev.filter((t) => t.templateId !== templateId));
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleSaved = useCallback(() => {
    void loadTemplates();
  }, [loadTemplates]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
        <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border bg-background shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-3">
              <Grid3X3 className="h-5 w-5 text-muted-foreground" />
              <div>
                <h2 className="text-lg font-semibold">Template Gallery</h2>
                <p className="text-sm text-muted-foreground">
                  Browse proposal templates or start from one
                </p>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search templates…"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              <CategoryChip
                label="All"
                active={activeCategory === null}
                onClick={() => setActiveCategory(null)}
              />
              {ALL_CATEGORIES.map((cat) => (
                <CategoryChip
                  key={cat}
                  label={cat}
                  active={activeCategory === cat}
                  onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                />
              ))}
              <div className="ml-2 h-4 w-px bg-border" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSaveDialogOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                Save Current
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full">
              <div className="p-5">
                {error !== null && (
                  <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </p>
                )}
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading templates…
                  </div>
                ) : filteredTemplates.length === 0 ? (
                  <div className="rounded-lg border border-dashed py-12 text-center">
                    <p className="text-sm font-medium">No templates found</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {templates.length === 0
                        ? "No templates available yet. Save your first template to get started."
                        : "Try adjusting your search or filters."}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredTemplates.map((template) => (
                      <TemplateCard
                        key={template.templateId}
                        template={template}
                        onUse={handleUseTemplate}
                        onDelete={(id) => void handleDeleteTemplate(id)}
                        busy={usingTemplateId === template.templateId}
                      />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

      <SaveTemplateDialog
        open={saveDialogOpen}
        draft={currentDraft}
        onClose={() => setSaveDialogOpen(false)}
        onSaved={handleSaved}
      />
    </>
  );
}

interface CategoryChipProps {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

function CategoryChip({ label, active, onClick }: CategoryChipProps): JSX.Element {
  return (
    <button
      type="button"
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
