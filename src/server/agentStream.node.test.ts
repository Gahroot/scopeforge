import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentResult } from "@kenkaiiii/gg-agent";
import { BUILT_IN_BRANDS } from "../proposal/brands.js";
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
  const stream = {
    async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      for (const event of events) yield event;
    },
  };
  const then: AgentLikeStream["then"] = (onfulfilled, onrejected) =>
    Promise.resolve(result).then(onfulfilled, onrejected);
  attachThenable(stream, then);
  return stream as AgentLikeStream;
}

function failingStream(error: Error): AgentLikeStream {
  const stream = {
    [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
      return {
        async next(): Promise<IteratorResult<AgentEvent>> {
          throw error;
        },
      };
    },
  };
  const then: AgentLikeStream["then"] = (onfulfilled, onrejected) =>
    Promise.reject(error).then(onfulfilled, onrejected);
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
    expect(start[0]).toMatchObject({
      type: "tool_start",
      name: "run_analysis",
      label: "Running analysis",
    });

    const end = eventToFrames(
      { type: "tool_call_end", toolCallId: "t1", result: "done", isError: false, durationMs: 5 },
      names,
    );
    expect(end[0]).toMatchObject({ type: "tool_end", name: "run_analysis", isError: false });
  });

  it("ignores unmapped events", () => {
    const names = new Map<string, string>();
    expect(
      eventToFrames(
        {
          type: "turn_end",
          turn: 1,
          stopReason: "end_turn",
          usage: {} as AgentResult["totalUsage"],
        },
        names,
      ),
    ).toEqual([]);
  });
});

describe("translateAgentStream", () => {
  it("emits frames, then a snapshot and done", async () => {
    const session = newSession();
    const stream = fakeStream(
      [
        { type: "text_delta", text: "Hello" },
        { type: "tool_call_start", toolCallId: "t1", name: "get_draft_summary", args: {} },
        {
          type: "tool_call_end",
          toolCallId: "t1",
          result: "summary",
          isError: false,
          durationMs: 1,
        },
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

  it("extracts project and base version identifiers", () => {
    const parsed = parseAgentMessageBody({
      message: "update the scope",
      projectId: " project-1 ",
      baseVersion: " version-2 ",
    });

    expect(parsed).toEqual({
      ok: true,
      value: { message: "update the scope", projectId: "project-1", baseVersion: "version-2" },
    });
  });

  it("rejects baseVersion without a projectId", () => {
    expect(parseAgentMessageBody({ message: "hello", baseVersion: "version-2" })).toEqual({
      ok: false,
      message: "baseVersion requires projectId.",
    });
  });

  it("rejects project-backed agent requests without a base version", () => {
    expect(parseAgentMessageBody({ message: "hello", projectId: "project-1" })).toEqual({
      ok: false,
      message: "projectId requires baseVersion.",
    });
  });

  it("accepts a lightweight collaborator display name", () => {
    const parsed = parseAgentMessageBody({
      message: "draft this",
      displayName: " Riley Chen ",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.author).toEqual({
      authorId: "riley-chen",
      displayName: "Riley Chen",
      kind: "human",
    });
  });

  it("validates and passes through imported vendor and client brands", () => {
    const parsed = parseAgentMessageBody({
      message: "hello",
      vendorBrand: BUILT_IN_BRANDS.nolan,
      clientBrand: BUILT_IN_BRANDS.partners,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.vendorBrand).toEqual(BUILT_IN_BRANDS.nolan);
    expect(parsed.value.clientBrand).toEqual(BUILT_IN_BRANDS.partners);
  });

  it("drops an invalid imported brand without failing the message", () => {
    const parsed = parseAgentMessageBody({
      message: "hello",
      vendorBrand: { id: "x", name: "", colors: {} },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.vendorBrand).toBeUndefined();
  });
});

describe("encodeSseFrame", () => {
  it("wraps a frame as an SSE data event", () => {
    const encoded = encodeSseFrame({ type: "done", totalTurns: 1 });
    expect(encoded).toBe('data: {"type":"done","totalTurns":1}\n\n');
  });
});
