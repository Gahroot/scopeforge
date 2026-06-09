import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Layers, Sparkles } from "lucide-react";
import { AgentSettingsDialog } from "./settings/AgentSettingsDialog.js";
import { BrandBar } from "./brand/BrandBar.js";
import type { BrandImportProjectUpdate, BrandRole } from "./brand/BrandImportDialog.js";
import { ChatPanel } from "./chat/ChatPanel.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { DraftPanel } from "./draft/DraftPanel.js";
import { useAgentStream } from "./chat/useAgentStream.js";
import {
  createProposalProject,
  fetchBrands,
  fetchHealth,
  fetchProposalProjects,
  fetchProposalProjectState,
  fetchProposalProjectUpdates,
  ingestSourceMaterial,
  fetchBatchJobStatus,
  type BatchJobStatusResponse,
  type CreateProposalProjectResponse,
  type HealthResponse,
  type ProposalProjectListItemResponse,
  type ProposalProjectStateResponse,
  type ProposalProjectUpdatesResponse,
} from "./lib/api.js";
import { projectUpdateFromState, type ProjectConflictNotice } from "./lib/collaboration.js";
import { projectStateToSessionSnapshot } from "./lib/projectSnapshot.js";
import { BatchJobCard } from "./projects/BatchJobCard.js";
import { BatchResults } from "./projects/BatchResults.js";
import { BatchUploadPanel } from "./projects/BatchUploadPanel.js";
import { CollaborationStatus } from "./projects/CollaborationStatus.js";
import { ProjectPicker } from "./projects/ProjectPicker.js";
import type { ProposalProject } from "../project/types.js";
import type { ProposalBrand } from "../proposal/types.js";

const PROJECT_UPDATES_POLL_MS = 5_000;

export function App(): JSX.Element {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [brands, setBrands] = useState<readonly ProposalBrand[]>([]);
  const [vendorBrand, setVendorBrand] = useState<ProposalBrand | null>(null);
  const [clientBrand, setClientBrand] = useState<ProposalBrand | null>(null);
  const [projects, setProjects] = useState<readonly ProposalProjectListItemResponse[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [projectState, setProjectState] = useState<ProposalProjectStateResponse | null>(null);
  const [projectUpdate, setProjectUpdate] = useState<ProposalProjectUpdatesResponse | null>(null);
  const [projectConflict, setProjectConflict] = useState<ProjectConflictNotice | null>(null);
  const [refreshingLatest, setRefreshingLatest] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [batchJobs, setBatchJobs] = useState<readonly BatchJobStatusResponse[]>([]);
  const [viewingBatchJobId, setViewingBatchJobId] = useState<string | null>(null);
  const [selectedProjectVersionId, setSelectedProjectVersionId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [stylePresetId, setStylePresetId] = useState<string | undefined>(undefined);
  const [extractingStyle, setExtractingStyle] = useState(false);
  const lastAppliedSnapshotRef = useRef<string | null>(null);
  const agent = useAgentStream();
  const collaboratorDisplayName = displayName.trim();
  const authorDisplayName = collaboratorDisplayName.length === 0 ? null : collaboratorDisplayName;

  const handleBatchJobCreated = useCallback((jobId: string): void => {
    // Fetch initial status and add to the list
    void (async () => {
      const result = await fetchBatchJobStatus(jobId);
      if (result.ok) {
        setBatchJobs((current) => {
          const without = current.filter((j) => j.jobId !== jobId);
          return [result.value, ...without];
        });
      }
    })();
  }, []);

  const handleViewBatchResults = useCallback((jobId: string): void => {
    setViewingBatchJobId(jobId);
  }, []);

  const applyProjectState = useCallback((nextState: ProposalProjectStateResponse): void => {
    setProjectState(nextState);
    setProjectUpdate(projectUpdateFromState(nextState));
    setProjectConflict(null);
    setSelectedProjectId(nextState.project.projectId);
    setSelectedProjectVersionId(nextState.currentVersion.versionId);
    setVendorBrand(nextState.sourceOfTruth.vendorBrand);
    setClientBrand(nextState.sourceOfTruth.clientBrand);
    setProjects((current) => upsertProjectListItem(current, projectListItemFromState(nextState)));
  }, []);

  const refreshProjects = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setProjectsLoading(true);
    setProjectError(null);
    try {
      const result = await fetchProposalProjects(signal);
      if (result.ok) setProjects(result.value.projects);
      else setProjectError(result.error.message);
    } catch (error) {
      if (signal?.aborted !== true) {
        setProjectError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (signal?.aborted !== true) setProjectsLoading(false);
    }
  }, []);

  const openProject = useCallback(
    async (projectId: string, options: { readonly resetChat: boolean } = { resetChat: true }) => {
      setOpeningProjectId(projectId);
      setProjectError(null);
      try {
        const result = await fetchProposalProjectState(projectId);
        if (!result.ok) {
          setProjectError(result.error.message);
          return;
        }
        applyProjectState(result.value);
        if (options.resetChat) agent.reset();
      } catch (error) {
        setProjectError(error instanceof Error ? error.message : String(error));
      } finally {
        setOpeningProjectId(null);
      }
    },
    [agent.reset, applyProjectState],
  );

  const createProject = useCallback(
    async (title: string): Promise<void> => {
      setCreatingProject(true);
      setProjectError(null);
      try {
        const result = await createProposalProject({
          title,
          ...(authorDisplayName === null ? {} : { displayName: authorDisplayName }),
        });
        if (!result.ok) {
          setProjectError(result.error.message);
          return;
        }
        applyProjectState(createResponseToProjectState(result.value));
        agent.reset();
      } catch (error) {
        setProjectError(error instanceof Error ? error.message : String(error));
      } finally {
        setCreatingProject(false);
      }
    },
    [agent.reset, applyProjectState, authorDisplayName],
  );

  const refreshHealth = useCallback(async (): Promise<void> => {
    const result = await fetchHealth();
    if (result.ok) {
      setHealth(result.value);
      setAgentEnabled(result.value.agent.enabled);
    }
  }, []);

  const handleImported = useCallback(
    (role: BrandRole, brand: ProposalBrand, projectUpdate?: BrandImportProjectUpdate): void => {
      if (role === "vendor") setVendorBrand(brand);
      else setClientBrand(brand);

      if (projectUpdate !== undefined) {
        applyProjectState({ ok: true, ...projectUpdate });
      }
    },
    [applyProjectState],
  );

  const handleProjectActivityUpdated = useCallback((project: ProposalProject): void => {
    setProjectState((current) => {
      if (current === null || current.project.projectId !== project.projectId) return current;
      const nextState = { ...current, project } satisfies ProposalProjectStateResponse;
      setProjectUpdate(projectUpdateFromState(nextState));
      setProjects((items) => upsertProjectListItem(items, projectListItemFromState(nextState)));
      return nextState;
    });
  }, []);

  const handleProjectConflict = useCallback((conflict: ProjectConflictNotice): void => {
    setProjectConflict(conflict);
  }, []);

  const handleStylePresetUpload = useCallback(async (file: File): Promise<void> => {
    setExtractingStyle(true);
    try {
      const result = await ingestSourceMaterial({
        sourceKind: "pdf",
        file: {
          name: file.name,
          ...(file.type.length === 0 ? {} : { mediaType: file.type }),
          base64: await fileToBase64(file),
        },
      });
      if (!result.ok) return;
      const { extractStyleFromText } = await import("../proposal/extractStyle.js");
      const preset = extractStyleFromText(result.value.document.text, {
        presetName: file.name.replace(/\.pdf$/i, ""),
        sourcePath: file.name,
      });
      agent.send(`I uploaded a reference PDF (\"${file.name}\") for style matching. ` +
        `Extracted ${preset.sections.length} sections with ${preset.tone.formality} tone. ` +
        `Please apply this style to the current proposal draft.`);
    } catch (error) {
      agent.send(`Style extraction failed: ${error instanceof Error ? error.message : String(error)}. Please try again or select a built-in style preset.`);
    } finally {
      setExtractingStyle(false);
    }
  }, [agent]);

  const refreshLatestProject = useCallback(async (): Promise<void> => {
    if (selectedProjectId === null) return;
    setRefreshingLatest(true);
    setProjectError(null);
    try {
      const result = await fetchProposalProjectState(selectedProjectId);
      if (!result.ok) {
        setProjectError(result.error.message);
        return;
      }
      applyProjectState(result.value);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshingLatest(false);
    }
  }, [applyProjectState, selectedProjectId]);

  useEffect(() => {
    const projectId = agent.snapshot?.projectId;
    const projectVersionId = agent.snapshot?.projectVersionId;
    if (projectId === undefined || projectVersionId === undefined) return;

    const snapshotKey = `${projectId}:${projectVersionId}`;
    if (lastAppliedSnapshotRef.current === snapshotKey) return;
    lastAppliedSnapshotRef.current = snapshotKey;
    setSelectedProjectId(projectId);
    setSelectedProjectVersionId(projectVersionId);

    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchProposalProjectState(projectId, controller.signal);
        if (result.ok) {
          applyProjectState(result.value);
        } else if (!controller.signal.aborted) {
          setProjectError(result.error.message);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setProjectError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => controller.abort();
  }, [agent.snapshot, applyProjectState]);

  useEffect(() => {
    if (agent.projectConflict !== null) setProjectConflict(agent.projectConflict);
  }, [agent.projectConflict]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [healthResult, brandsResult, projectsResult] = await Promise.all([
          fetchHealth(controller.signal),
          fetchBrands(controller.signal),
          fetchProposalProjects(controller.signal),
        ]);
        if (healthResult.ok) {
          setHealth(healthResult.value);
          setAgentEnabled(healthResult.value.agent.enabled);
        }
        if (brandsResult.ok) setBrands(brandsResult.value.brands);
        if (projectsResult.ok) setProjects(projectsResult.value.projects);
        else setProjectError(projectsResult.error.message);
      } catch (error) {
        if (!controller.signal.aborted) {
          setProjectError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!controller.signal.aborted) setProjectsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedProjectId === null) return;

    const controller = new AbortController();
    const pollProjectUpdates = async (): Promise<void> => {
      try {
        const result = await fetchProposalProjectUpdates(selectedProjectId, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          setProjectUpdate(result.value);
        } else if (result.error.code === "project_not_found") {
          setProjectError(result.error.message);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setProjectError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void pollProjectUpdates();
    const intervalId = window.setInterval(() => void pollProjectUpdates(), PROJECT_UPDATES_POLL_MS);
    return () => {
      window.clearInterval(intervalId);
      controller.abort();
    };
  }, [selectedProjectId]);

  const projectSnapshot = useMemo(
    () => (projectState === null ? null : projectStateToSessionSnapshot(projectState)),
    [projectState],
  );
  const agentSnapshotMatchesSelected =
    agent.snapshot !== null &&
    agent.snapshot.projectId === selectedProjectId &&
    agent.snapshot.projectVersionId === selectedProjectVersionId;
  const visibleSnapshot = agentSnapshotMatchesSelected ? agent.snapshot : projectSnapshot;
  const projectIsOpen = projectState !== null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="shrink-0 leading-tight">
              <div className="text-sm font-semibold">ScopeForge</div>
              <div className="text-xs text-muted-foreground">Proposal Copilot</div>
            </div>
            {projectState !== null && (
              <ProjectHeaderSummary
                state={projectState}
                onBackToProjects={() => {
                  setProjectState(null);
                  setProjectUpdate(null);
                  setProjectConflict(null);
                  setSelectedProjectId(null);
                  setSelectedProjectVersionId(null);
                  setVendorBrand(null);
                  setClientBrand(null);
                  agent.reset();
                }}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <label
              className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"
              htmlFor="scopeforge-collaborator-display-name"
            >
              Collaborator
              <Input
                id="scopeforge-collaborator-display-name"
                className="h-8 w-40"
                placeholder="Local collaborator"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            {projectIsOpen && (
              <BrandBar
                vendorBrand={vendorBrand}
                clientBrand={clientBrand}
                projectId={selectedProjectId}
                baseVersionId={selectedProjectVersionId}
                displayName={authorDisplayName}
                onImported={handleImported}
                onProjectConflict={handleProjectConflict}
              />
            )}

            <div className="text-xs text-muted-foreground">
              {health === null
                ? "Connecting…"
                : `API v${health.apiVersion}${agentEnabled ? "" : " · agent offline — open Settings"}`}
            </div>
            <AgentSettingsDialog onAgentChanged={refreshHealth} />
          </div>
        </header>

        {selectedProjectId === null && viewingBatchJobId !== null && batchJobs.length > 0 && (
          <div className="border-b bg-muted/20 px-6 py-2">
            <div className="mx-auto flex max-w-5xl items-center gap-2 text-xs text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              <span>Viewing batch results</span>
            </div>
          </div>
        )}
        {projectState !== null && (
          <CollaborationStatus
            state={projectState}
            update={projectUpdate}
            conflict={projectConflict}
            refreshing={refreshingLatest}
            onRefreshLatest={() => void refreshLatestProject()}
          />
        )}

        {projectIsOpen ? (
          <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
            <ChatPanel
              agent={agent}
              agentEnabled={agentEnabled}
              displayName={authorDisplayName}
              projectId={selectedProjectId}
              baseVersion={selectedProjectVersionId}
              vendorBrand={vendorBrand}
              clientBrand={clientBrand}
            />
            <DraftPanel
              snapshot={visibleSnapshot}
              brands={brands}
              busy={agent.status !== "idle"}
              vendorBrand={vendorBrand}
              displayName={authorDisplayName}
              stylePresetId={stylePresetId}
              extractingStyle={extractingStyle}
              onStylePresetChange={(id) => setStylePresetId(id ?? undefined)}
              onUploadReference={(file) => void handleStylePresetUpload(file)}
              onProjectConflict={handleProjectConflict}
              onProjectUpdated={handleProjectActivityUpdated}
              onProjectActivitySaved={() => void refreshLatestProject()}
            />
          </main>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-muted/30">
            <div className="mx-auto grid w-full max-w-5xl flex-1 gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                {viewingBatchJobId !== null ? (
                  <BatchResults
                    jobId={viewingBatchJobId}
                    onOpenProject={(projectId) => void openProject(projectId)}
                    onBack={() => setViewingBatchJobId(null)}
                  />
                ) : (
                  <ProjectPicker
                    projects={projects}
                    loading={projectsLoading}
                    creating={creatingProject}
                    openingProjectId={openingProjectId}
                    error={projectError}
                    displayName={authorDisplayName}
                    onCreate={(title) => void createProject(title)}
                    onOpen={(projectId) => void openProject(projectId)}
                    onRefresh={() => void refreshProjects()}
                  />
                )}
                {batchJobs.length > 0 && viewingBatchJobId === null && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold">Batch Jobs</h2>
                    </div>
                    <div className="space-y-3">
                      {batchJobs.map((job) => (
                        <BatchJobCard
                          key={job.jobId}
                          job={job}
                          onViewResults={handleViewBatchResults}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <BatchUploadPanel onJobCreated={handleBatchJobCreated} />
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

interface ProjectHeaderSummaryProps {
  readonly state: ProposalProjectStateResponse;
  readonly onBackToProjects: () => void;
}

function ProjectHeaderSummary({ state, onBackToProjects }: ProjectHeaderSummaryProps): JSX.Element {
  return (
    <div className="hidden min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs md:flex">
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{state.project.title}</span>
      <Badge variant={state.project.status === "active" ? "secondary" : "outline"}>
        {state.project.status}
      </Badge>
      <span className="shrink-0 text-muted-foreground">v{state.currentVersion.versionNumber}</span>
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onBackToProjects}>
        Projects
      </Button>
    </div>
  );
}

function createResponseToProjectState(
  response: CreateProposalProjectResponse,
): ProposalProjectStateResponse {
  return {
    ok: true,
    project: response.project,
    currentVersion: response.currentVersion,
    sourceOfTruth: response.sourceOfTruth,
  } satisfies ProposalProjectStateResponse;
}

function projectListItemFromState(
  state: ProposalProjectStateResponse,
): ProposalProjectListItemResponse {
  return {
    projectId: state.project.projectId,
    title: state.project.title,
    status: state.project.status,
    createdAt: state.project.createdAt,
    updatedAt: state.project.updatedAt,
    currentVersionId: state.project.currentVersionId,
    versionCount: state.project.versions.length,
  } satisfies ProposalProjectListItemResponse;
}

function upsertProjectListItem(
  projects: readonly ProposalProjectListItemResponse[],
  item: ProposalProjectListItemResponse,
): readonly ProposalProjectListItemResponse[] {
  const withoutItem = projects.filter((project) => project.projectId !== item.projectId);
  return [item, ...withoutItem].sort(compareProjectListItems);
}

function compareProjectListItems(
  left: ProposalProjectListItemResponse,
  right: ProposalProjectListItemResponse,
): number {
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  if (updated !== 0) return updated;
  const title = left.title.localeCompare(right.title);
  if (title !== 0) return title;
  return left.projectId.localeCompare(right.projectId);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("Could not read file as bytes."));
        return;
      }
      let binary = "";
      const bytes = new Uint8Array(reader.result);
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      resolve(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  });
}
