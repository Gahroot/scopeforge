import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentResult } from "@kenkaiiii/gg-agent";
import { createSessionStore, type AgentSession } from "../agent/session.node.js";
import type { AgentStreamFrame } from "../ui/lib/types.js";
import {
  eventToFrames,
  errorFrame,
  encodeSseFrame,
  parseAgentMessageBody,
  translateAgentStream,
  type AgentLikeStream,
} from "./agentStream.node.js";

function newSession(): AgentSession {
  return createSessionStore({ idFactory: () => "sse-session" }).create();
}

/** Minimal AgentStream stand-in: async-iterable of events + thenable for the result. */
function fakeStream(events: readonly AgentEvent[], result: AgentResult): AgentLikeStream {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      for (const event of events) yield event;
    },
    then(onfulfilled) {
      return Promise.resolve(result).then(onfulfilled);
    },
  } as AgentLikeStream;
}

function failingStream(error: Error): AgentLikeStream {
  return {
    // eslint-disable-next-line require-yield
    async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      throw error;
    },
    then(onfulfilled, onrejected) {
      return Promise.reject(error).then(onfulfilled, onrejected);
    },
  } as AgentLikeStream;
}

async function collect(stream: AsyncGenerator<AgentStreamFrame>): Promise<AgentStreamFrame[]> {
  const frames: AgentStreamFrame[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}

const doneResult: AgentResult = {
  message: { role: "assistant", content: "ok" },
  totalTurns: 2,
  totalUsage: {} as AgentResult["totalUsage"],
};

describe("eventToFrames", () => {
  it("maps text and thinking deltas", () => {
    const names = new Map<string, string>();
    expect(eventToFrames({ type: "text_delta", text: "hi" }, names)).toEqual([
      { type: "text_delta", text: "hi" },
    ]);
    expect(eventToFrames({ type: "thinking_delta", text: "hmm" }, names)).toEqual([
      { type: "thinking_delta", text: "hmm" },
    ]);
  });

  it("tracks tool name across start and end", () => {
    const names = new Map<string, string>();
    const start = eventToFrames(
      { type: "tool_call_start", toolCallId: "t1", name: "run_analysis", args: {} },
      names,
    );
    expect(start[0]).toMatchObject({ type: "tool_start", name: "run_analysis", label: "Running analysis" });

    const end = eventToFrames(
      { type: "tool_call_end", toolCallId: "t1", result: "done", isError: false, durationMs: 5 },
      names,
    );
    expect(end[0]).toMatchObject({ type: "tool_end", name: "run_analysis", isError: false });
  });

  it("ignores unmapped events", () => {
    const names = new Map<string, string>();
    expect(eventToFrames({ type: "turn_end", turn: 1, stopReason: "end_turn", usage: {} as AgentResult["totalUsage"] }, names)).toEqual([]);
  });
});

describe("translateAgentStream", () => {
  it("emits frames, then a snapshot and done", async () => {
    const session = newSession();
    const stream = fakeStream(
      [
        { type: "text_delta", text: "Hello" },
        { type: "tool_call_start", toolCallId: "t1", name: "get_draft_summary", args: {} },
        { type: "tool_call_end", toolCallId: "t1", result: "summary", isError: false, durationMs: 1 },
      ],
      doneResult,
    );

    const frames = await collect(translateAgentStream(stream, session));
    const types = frames.map((frame) => frame.type);
    expect(types).toEqual(["text_delta", "tool_start", "tool_end", "snapshot", "done"]);
    const done = frames.at(-1);
    expect(done).toMatchObject({ type: "done", totalTurns: 2 });
    const snap = frames.find((frame) => frame.type === "snapshot");
    expect(snap).toMatchObject({ type: "snapshot" });
  });

  it("maps a thrown error to a snapshot + error frame", async () => {
    const session = newSession();
    const frames = await collect(translateAgentStream(failingStream(new Error("boom")), session));
    expect(frames.map((frame) => frame.type)).toEqual(["snapshot", "error"]);
    expect(frames.at(-1)).toMatchObject({ type: "error", code: "agent_error", message: "boom" });
  });
});

describe("errorFrame", () => {
  it("classifies billing errors", () => {
    const billing = new Error("429 Insufficient balance");
    expect(errorFrame(billing)).toMatchObject({ code: "billing" });
  });

  it("classifies abort errors", () => {
    const abort = new DOMException("Aborted", "AbortError");
    expect(errorFrame(abort)).toMatchObject({ code: "aborted" });
  });
});

describe("parseAgentMessageBody", () => {
  it("requires a non-empty message", () => {
    expect(parseAgentMessageBody({}).ok).toBe(false);
    expect(parseAgentMessageBody({ message: "  " }).ok).toBe(false);
  });

  it("extracts session, brand, and audience", () => {
    const parsed = parseAgentMessageBody({
      message: " draft this ",
      sessionId: "s1",
      brandId: "nolan",
      audience: "internal",
    });
    expect(parsed).toEqual({
      ok: true,
      value: { message: "draft this", sessionId: "s1", brandId: "nolan", audience: "internal" },
    });
  });
});

describe("encodeSseFrame", () => {
  it("wraps a frame as an SSE data event", () => {
    const encoded = encodeSseFrame({ type: "done", totalTurns: 1 });
    expect(encoded).toBe('data: {"type":"done","totalTurns":1}\n\n');
  });
});
