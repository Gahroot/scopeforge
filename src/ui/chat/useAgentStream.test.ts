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
});
