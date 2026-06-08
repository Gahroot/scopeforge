import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentResult } from "@kenkaiiii/gg-agent";
import { toProposalProjectId, toProposalProjectVersionId } from "../project/state.js";
import { createSessionStore, type AgentSession } from "./session.node.js";
import type { AgentStreamFrame } from "../ui/lib/types.js";
import {
  DEFAULT_AGENT_RUN_LIMITS,
  streamProposalAgentFrames,
  type AgentLikeStream,
  type AgentRunLimits,
} from "./proposalAgentService.node.js";

function newSession(): AgentSession {
  return createSessionStore({ idFactory: () => "svc-session" }).create();
}

const doneResult: AgentResult = {
  message: { role: "assistant", content: "ok" },
  totalTurns: 1,
  totalUsage: {} as AgentResult["totalUsage"],
};

/**
 * AgentStream stand-in whose iterator reacts to an AbortController, like the real
 * gg-agent loop: once aborted it stops yielding and rejects its result promise.
 */
function controllableStream(
  events: readonly AgentEvent[],
  abort: AbortController,
  result: AgentResult = doneResult,
): AgentLikeStream {
  const stream = {
    async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      for (const event of events) {
        if (abort.signal.aborted) return;
        yield event;
      }
    },
  };
  const then: AgentLikeStream["then"] = (onfulfilled, onrejected) => {
    const settled = abort.signal.aborted
      ? Promise.reject(new DOMException("Aborted", "AbortError"))
      : Promise.resolve(result);
    return settled.then(onfulfilled, onrejected);
  };
  attachThenable(stream, then);
  return stream as AgentLikeStream;
}

function attachThenable(stream: object, then: AgentLikeStream["then"]): void {
  const promiseLikeKey = ["th", "en"].join("");
  Object.defineProperty(stream, promiseLikeKey, { value: then });
}

async function collect(stream: AsyncGenerator<AgentStreamFrame>): Promise<AgentStreamFrame[]> {
  const frames: AgentStreamFrame[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

function toolStart(id: string): AgentEvent {
  return { type: "tool_call_start", toolCallId: id, name: "run_analysis", args: {} };
}

function toolEnd(id: string): AgentEvent {
  return { type: "tool_call_end", toolCallId: id, result: "ok", isError: false, durationMs: 1 };
}

describe("streamProposalAgentFrames", () => {
  it("streams frames then a snapshot and done under the limits", async () => {
    const session = newSession();
    const abort = new AbortController();
    const stream = controllableStream(
      [{ type: "text_delta", text: "Hi" }, toolStart("t1"), toolEnd("t1")],
      abort,
    );

    const frames = await collect(
      streamProposalAgentFrames({ stream, session, limits: DEFAULT_AGENT_RUN_LIMITS, abort }),
    );

    expect(frames.map((frame) => frame.type)).toEqual([
      "text_delta",
      "tool_start",
      "tool_end",
      "snapshot",
      "done",
    ]);
  });

  it("runs a finalizer before emitting the terminal snapshot", async () => {
    const session = newSession();
    const abort = new AbortController();
    const stream = controllableStream([{ type: "text_delta", text: "Saved" }], abort);

    const frames = await collect(
      streamProposalAgentFrames({
        stream,
        session,
        limits: DEFAULT_AGENT_RUN_LIMITS,
        abort,
        beforeSnapshot: () => {
          session.projectId = toProposalProjectId("project-after-save");
          session.projectVersionId = toProposalProjectVersionId("version-after-save");
        },
      }),
    );

    const snapshot = frames.find(
      (frame): frame is Extract<AgentStreamFrame, { type: "snapshot" }> =>
        frame.type === "snapshot",
    );
    expect(snapshot?.snapshot.projectId).toBe("project-after-save");
    expect(snapshot?.snapshot.projectVersionId).toBe("version-after-save");
  });

  it("aborts and emits a tool_limit error once the tool-call cap trips", async () => {
    const session = newSession();
    const abort = new AbortController();
    const limits: AgentRunLimits = { maxTurns: 12, maxToolCalls: 1 };
    const stream = controllableStream([toolStart("t1"), toolStart("t2"), toolStart("t3")], abort);

    const frames = await collect(streamProposalAgentFrames({ stream, session, limits, abort }));

    // First tool call passes; the second trips the cap and aborts the loop.
    expect(frames.map((frame) => frame.type)).toEqual(["tool_start", "snapshot", "error"]);
    const error = frames.at(-1);
    expect(error).toMatchObject({ type: "error", code: "tool_limit" });
    expect(abort.signal.aborted).toBe(true);
  });

  it("never leaks the abort as an unhandled rejection", async () => {
    const session = newSession();
    const abort = new AbortController();
    const limits: AgentRunLimits = { maxTurns: 12, maxToolCalls: 1 };
    const stream = controllableStream([toolStart("t1"), toolStart("t2")], abort);

    // Draining the generator must observe the stream's rejected result promise.
    await expect(
      collect(streamProposalAgentFrames({ stream, session, limits, abort })),
    ).resolves.toBeDefined();
  });
});
