import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProposalDraft } from "../../proposal/types.js";
import {
  createProposalProject,
  exportProposalProjectPdf,
  fetchProposalProjectUpdates,
  importProjectBrand,
  previewProposalProject,
} from "./api.js";

describe("UI API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates proposal projects with the collaborator display name", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/proposal-projects");
      expect(init?.method).toBe("POST");
      expect(readJsonBody(init)).toEqual({
        title: "Acme AI pilot",
        displayName: "Riley Chen",
      });
      return jsonResponse({ ok: true, project: {}, currentVersion: {}, sourceOfTruth: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createProposalProject({
      title: "Acme AI pilot",
      displayName: "Riley Chen",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("posts project id, base version, and author context to project actions", async () => {
    const calls: Array<{ readonly path: string; readonly body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      calls.push({ path, body: readJsonBody(init) });
      if (path.endsWith("/export-pdf")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Disposition": 'attachment; filename="acme.pdf"',
            "X-ScopeForge-Pdf-Artifact-Uri": "artifacts/version-2/acme.pdf",
          },
        });
      }
      if (path.endsWith("/brands/import")) {
        return jsonResponse({
          ok: true,
          role: "vendor",
          brand: {},
          provenance: {},
          project: {},
          currentVersion: {},
          sourceOfTruth: {},
        });
      }
      return jsonResponse({ ok: true, html: "<h1>Preview</h1>", audience: "client" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const draft = {} as ProposalDraft;

    await previewProposalProject("project 1", {
      draft,
      audience: "client",
      baseVersionId: "version-2",
      displayName: "Riley Chen",
    });
    const exportResult = await exportProposalProjectPdf("project 1", {
      draft,
      audience: "client",
      baseVersionId: "version-2",
      displayName: "Riley Chen",
    });
    await importProjectBrand(
      "project 1",
      "version-2",
      "vendor",
      "https://acme.example",
      "Riley Chen",
    );

    expect(exportResult).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          fileName: "acme.pdf",
          pdfArtifactUri: "artifacts/version-2/acme.pdf",
        }),
      }),
    );
    expect(calls).toEqual([
      {
        path: "/api/proposal-projects/project%201/preview",
        body: {
          draft,
          audience: "client",
          baseVersionId: "version-2",
          displayName: "Riley Chen",
        },
      },
      {
        path: "/api/proposal-projects/project%201/export-pdf",
        body: {
          draft,
          audience: "client",
          baseVersionId: "version-2",
          displayName: "Riley Chen",
        },
      },
      {
        path: "/api/proposal-projects/project%201/brands/import",
        body: {
          role: "vendor",
          url: "https://acme.example",
          baseVersionId: "version-2",
          displayName: "Riley Chen",
        },
      },
    ]);
  });

  it("polls the lightweight project-updates endpoint for refresh metadata", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/proposal-projects/project%201/updates");
      expect(init?.method).toBeUndefined();
      return jsonResponse({
        ok: true,
        projectId: "project 1",
        latestProject: {
          projectId: "project 1",
          title: "Acme AI pilot",
          status: "active",
          updatedAt: "2026-06-07T13:00:00.000Z",
          updatedBy: {
            authorId: "partner-2",
            displayName: "Partner Two",
            kind: "human",
          },
          currentVersionId: "version-3",
          currentVersionNumber: 3,
          versionCount: 3,
        },
        latestVersion: {
          versionId: "version-3",
          versionNumber: 3,
          createdAt: "2026-06-07T13:00:00.000Z",
          createdBy: {
            authorId: "partner-2",
            displayName: "Partner Two",
            kind: "human",
          },
          source: "human-edit",
        },
        artifactSummary: {
          artifactCount: 1,
          latestPdfArtifact: {
            artifactId: "artifact-pdf-1",
            kind: "proposal-pdf",
            origin: "render",
            uri: "artifacts/version-3/acme.pdf",
            createdAt: "2026-06-07T13:05:00.000Z",
            createdBy: {
              authorId: "partner-2",
              displayName: "Partner Two",
              kind: "human",
            },
            sourceVersionId: "version-3",
            sourceVersionHash: "sha256:source",
          },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProposalProjectUpdates("project 1");

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          latestProject: expect.objectContaining({ currentVersionId: "version-3" }),
          artifactSummary: expect.objectContaining({ artifactCount: 1 }),
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves latest project metadata from conflict API responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            error: {
              code: "base_version_conflict",
              message: "Project has changed since the provided baseVersionId.",
              latestProject: {
                projectId: "project-1",
                title: "Acme AI pilot",
                status: "active",
                updatedAt: "2026-06-07T14:00:00.000Z",
                updatedBy: {
                  authorId: "partner-2",
                  displayName: "Partner Two",
                  kind: "human",
                },
                currentVersionId: "version-4",
                currentVersionNumber: 4,
                versionCount: 4,
              },
            },
          },
          409,
        ),
      ),
    );

    const result = await previewProposalProject("project-1", {
      draft: {} as ProposalDraft,
      audience: "client",
      baseVersionId: "version-2",
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "base_version_conflict",
          latestProject: expect.objectContaining({ currentVersionNumber: 4 }),
        }),
      }),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function readJsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(init.body) as unknown;
}
