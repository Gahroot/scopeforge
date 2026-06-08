import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProposalDraft } from "../../proposal/types.js";
import {
  createProposalProject,
  exportProposalProjectPdf,
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
          headers: { "Content-Disposition": 'attachment; filename="acme.pdf"' },
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
        value: expect.objectContaining({ fileName: "acme.pdf" }),
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
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function readJsonBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(init.body) as unknown;
}
