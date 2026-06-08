import { describe, expect, it } from "vitest";
import { BUILT_IN_BRANDS } from "../../proposal/brands.js";
import { buildAgentMessageRequest } from "./useAgentStream.js";

describe("buildAgentMessageRequest", () => {
  it("includes selected project, base version, and collaborator display name", () => {
    expect(
      buildAgentMessageRequest("Update the scope", "session-1", {
        projectId: "project-1",
        baseVersion: "version-2",
        displayName: "Riley Chen",
        vendorBrand: BUILT_IN_BRANDS.nolan,
        clientBrand: BUILT_IN_BRANDS.partners,
      }),
    ).toEqual({
      message: "Update the scope",
      sessionId: "session-1",
      projectId: "project-1",
      baseVersion: "version-2",
      displayName: "Riley Chen",
      vendorBrand: BUILT_IN_BRANDS.nolan,
      clientBrand: BUILT_IN_BRANDS.partners,
    });
  });

  it("starts a project-backed new chat without replaying the old session or stale base version", () => {
    expect(
      buildAgentMessageRequest("Continue from the latest saved draft", "session-old", {
        projectId: "project-1",
        baseVersion: "version-stale",
        newChatFromLatestProject: true,
        displayName: "Riley Chen",
      }),
    ).toEqual({
      message: "Continue from the latest saved draft",
      projectId: "project-1",
      newChatFromLatestProject: true,
      displayName: "Riley Chen",
    });
  });
});
