import { useState } from "react";
import { FolderOpen, Loader2, Plus, RefreshCw } from "lucide-react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import type { ProposalProjectListItemResponse } from "../lib/api.js";

export interface ProjectPickerProps {
  readonly projects: readonly ProposalProjectListItemResponse[];
  readonly loading: boolean;
  readonly creating: boolean;
  readonly openingProjectId: string | null;
  readonly error: string | null;
  readonly displayName: string | null;
  readonly onCreate: (title: string) => void;
  readonly onOpen: (projectId: string) => void;
  readonly onRefresh: () => void;
}

export function ProjectPicker({
  projects,
  loading,
  creating,
  openingProjectId,
  error,
  displayName,
  onCreate,
  onOpen,
  onRefresh,
}: ProjectPickerProps): JSX.Element {
  const [title, setTitle] = useState("");
  const trimmedTitle = title.trim();
  const createDisabled = creating || trimmedTitle.length === 0;

  return (
    <main className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/30 p-6">
      <div className="grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Open a proposal project</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick a persisted project workspace before chatting, previewing, importing brands,
                  or exporting.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {error !== null && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading proposal projects…</p>
            ) : projects.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-sm font-medium">No proposal projects yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create one to start a durable copilot workspace.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => (
                  <ProjectListItem
                    key={project.projectId}
                    project={project}
                    opening={openingProjectId === project.projectId}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create project</CardTitle>
            <p className="text-sm text-muted-foreground">
              Starts with a safe draft that the copilot can refine inside versioned project storage.
            </p>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (createDisabled) return;
                onCreate(trimmedTitle);
                setTitle("");
              }}
            >
              <label className="space-y-1 text-sm font-medium" htmlFor="scopeforge-project-title">
                Project name
                <Input
                  id="scopeforge-project-title"
                  placeholder="Acme AI pilot proposal"
                  value={title}
                  disabled={creating}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Author: {displayName === null ? "Local collaborator" : displayName}
              </p>
              <Button type="submit" className="w-full" disabled={createDisabled}>
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create and open
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

interface ProjectListItemProps {
  readonly project: ProposalProjectListItemResponse;
  readonly opening: boolean;
  readonly onOpen: (projectId: string) => void;
}

function ProjectListItem({ project, opening, onOpen }: ProjectListItemProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{project.title}</p>
          <Badge variant={project.status === "active" ? "secondary" : "outline"}>
            {project.status}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Version {project.versionCount} · updated {formatProjectDate(project.updatedAt)}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpen(project.projectId)}
        disabled={opening}
      >
        {opening ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FolderOpen className="h-4 w-4" />
        )}
        Open
      </Button>
    </div>
  );
}

function formatProjectDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
