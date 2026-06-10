import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, MoreVertical, Trash2, WandSparkles } from "lucide-react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import type { TemplateListItem } from "../lib/api.js";

const CATEGORY_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "success" | "warning"
> = {
  SaaS: "default",
  Mobile: "secondary",
  Automation: "success",
  Consulting: "warning",
  Custom: "outline",
} as const;

export interface TemplateCardProps {
  readonly template: TemplateListItem;
  readonly onUse: (templateId: string) => void;
  readonly onDelete: (templateId: string) => void;
  readonly busy?: boolean;
}

export function TemplateCard({
  template,
  onUse,
  onDelete,
  busy = false,
}: TemplateCardProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (event: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen, closeMenu]);

  const badgeVariant = CATEGORY_VARIANT[template.category] ?? "outline";

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{template.name}</h3>
            {template.builtIn && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
          </div>
          <Badge variant={badgeVariant} className="mt-1">
            {template.category}
          </Badge>
        </div>
        {!template.builtIn && (
          <div className="relative shrink-0" ref={menuRef}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-md border bg-background py-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    closeMenu();
                    onDelete(template.templateId);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {template.description}
      </p>

      {template.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-1">
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() => onUse(template.templateId)}
        >
          <WandSparkles className="h-3.5 w-3.5" />
          Use This Template
        </Button>
      </div>
    </div>
  );
}
