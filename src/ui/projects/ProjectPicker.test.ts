import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectPicker } from "./ProjectPicker.js";

describe("ProjectPicker", () => {
  it("renders persisted projects and the create flow entry point", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectPicker, {
        projects: [
          {
            projectId: "project-1",
            title: "Acme AI pilot",
            status: "active",
            createdAt: "2026-06-07T12:00:00.000Z",
            updatedAt: "2026-06-07T13:00:00.000Z",
            currentVersionId: "version-2",
            versionCount: 2,
          },
        ],
        loading: false,
        creating: false,
        openingProjectId: null,
        error: null,
        displayName: "Riley Chen",
        onCreate: vi.fn(),
        onOpen: vi.fn(),
        onRefresh: vi.fn(),
        onOpenTemplateGallery: vi.fn(),
      }),
    );

    expect(html).toContain("Open a proposal project");
    expect(html).toContain("Acme AI pilot");
    expect(html).toContain("Version 2");
    expect(html).toContain("Start from Scratch");
    expect(html).toContain("Start from Template");
    expect(html).toContain("Author: Riley Chen");
  });
});
