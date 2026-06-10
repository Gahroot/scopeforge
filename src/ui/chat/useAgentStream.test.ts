import { describe, expect, it, vi } from "vitest";
import { BUILT_IN_BRANDS } from "../../proposal/brands.js";
import type { AgentStatus } from "./useAgentStream.js";
import { buildAgentMessageRequest, releaseRunOwnership } from "./useAgentStream.js";

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

describe("releaseRunOwnership", () => {
  it("releases the controller and resets status when the run still owns the ref", () => {
    const controller = new AbortController();
    const abortRef = { current: controller as AbortController | null };
    const setStatus = vi.fn<(status: AgentStatus) => void>();

    expect(releaseRunOwnership(abortRef, controller, setStatus)).toBe(true);
    expect(abortRef.current).toBeNull();
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith("idle");
  });

  it("stop then immediate send: stale run's cleanup must not clobber the new run", () => {
    const setStatus = vi.fn<(status: AgentStatus) => void>();
    const abortRef = { current: null as AbortController | null };

    // Run A starts.
    const controllerA = new AbortController();
    abortRef.current = controllerA;

    // User hits Stop: stop() aborts and releases the ref, status goes idle.
    abortRef.current.abort();
    abortRef.current = null;
    setStatus("idle");

    // Run B starts immediately.
    const controllerB = new AbortController();
    abortRef.current = controllerB;
    setStatus("thinking");
    setStatus.mockClear();

    // Run A's async catch/finally fires late. It no longer owns the ref,
    // so it must not null out B's controller or force status back to idle.
    expect(releaseRunOwnership(abortRef, controllerA, setStatus)).toBe(false);
    expect(abortRef.current).toBe(controllerB);
    expect(setStatus).not.toHaveBeenCalled();

    // Stop still works for run B, and B's own cleanup releases normally.
    expect(releaseRunOwnership(abortRef, controllerB, setStatus)).toBe(true);
    expect(abortRef.current).toBeNull();
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith("idle");
  });

  it("does nothing when the ref was already released by stop()", () => {
    const controller = new AbortController();
    const abortRef = { current: null as AbortController | null };
    const setStatus = vi.fn<(status: AgentStatus) => void>();

    expect(releaseRunOwnership(abortRef, controller, setStatus)).toBe(false);
    expect(abortRef.current).toBeNull();
    expect(setStatus).not.toHaveBeenCalled();
  });
});
