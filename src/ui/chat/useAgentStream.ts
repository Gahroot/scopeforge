import { useCallback, useRef, useState } from "react";
import type { ProjectConflictNotice } from "../lib/collaboration.js";
import type { AgentMessageRequest, AgentStreamFrame, SessionSnapshot } from "../lib/types.js";

export type AgentStatus = "idle" | "thinking" | "streaming" | "tool";

export interface ToolActivityItem {
  readonly toolCallId: string;
  readonly name: string;
  readonly label: string;
  summary?: string;
  done: boolean;
  isError: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  text: string;
  thinking?: string;
  tools: ToolActivityItem[];
  streaming?: boolean;
  error?: string;
}

export type AgentSendOptions = Pick<
  AgentMessageRequest,
  | "projectId"
  | "baseVersion"
  | "brandId"
  | "audience"
  | "author"
  | "displayName"
  | "vendorBrand"
  | "clientBrand"
>;

export interface AgentStreamApi {
  readonly messages: readonly ChatMessage[];
  readonly status: AgentStatus;
  readonly snapshot: SessionSnapshot | null;
  readonly error: string | null;
  readonly projectConflict: ProjectConflictNotice | null;
  send(message: string, options?: AgentSendOptions): Promise<void>;
  stop(): void;
  reset(): void;
}

export function buildAgentMessageRequest(
  message: string,
  sessionId: string | null,
  options?: AgentSendOptions,
): AgentMessageRequest {
  return {
    message,
    ...(sessionId === null ? {} : { sessionId }),
    ...(options?.projectId === undefined ? {} : { projectId: options.projectId }),
    ...(options?.baseVersion === undefined ? {} : { baseVersion: options.baseVersion }),
    ...(options?.brandId === undefined ? {} : { brandId: options.brandId }),
    ...(options?.audience === undefined ? {} : { audience: options.audience }),
    ...(options?.author === undefined ? {} : { author: options.author }),
    ...(options?.displayName === undefined ? {} : { displayName: options.displayName }),
    ...(options?.vendorBrand === undefined ? {} : { vendorBrand: options.vendorBrand }),
    ...(options?.clientBrand === undefined ? {} : { clientBrand: options.clientBrand }),
  } satisfies AgentMessageRequest;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function useAgentStream(): AgentStreamApi {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectConflict, setProjectConflict] = useState<ProjectConflictNotice | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const patchAssistant = useCallback((id: string, update: (message: ChatMessage) => void): void => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== id) return message;
        const next = { ...message, tools: [...message.tools] };
        update(next);
        return next;
      }),
    );
  }, []);

  const send = useCallback(
    async (text: string, options?: AgentSendOptions): Promise<void> => {
      if (status !== "idle") return;
      setError(null);
      setProjectConflict(null);
      const assistantId = makeId();
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "user", text, tools: [] },
        { id: assistantId, role: "assistant", text: "", tools: [], streaming: true },
      ]);
      setStatus("thinking");

      const controller = new AbortController();
      abortRef.current = controller;
      const requestBody = buildAgentMessageRequest(text, sessionIdRef.current, options);

      try {
        const response = await fetch("/api/agent/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok || response.body === null) {
          const errorPayload = await readErrorPayload(response);
          patchAssistant(assistantId, (m) => {
            m.error = errorPayload.message;
            m.streaming = false;
          });
          setError(errorPayload.message);
          if (errorPayload.latestProject !== undefined) {
            setProjectConflict({
              action: "agent",
              message: errorPayload.message,
              latestProject: errorPayload.latestProject,
              occurredAt: new Date().toISOString(),
            });
          }
          setStatus("idle");
          return;
        }

        await consumeSse(response.body, (frame) => {
          applyFrame(frame, assistantId, {
            patchAssistant,
            setStatus,
            setSnapshot,
            setError,
            setProjectConflict,
            sessionIdRef,
          });
        });
      } catch (caught) {
        if (!controller.signal.aborted) {
          const message = caught instanceof Error ? caught.message : String(caught);
          patchAssistant(assistantId, (m) => {
            m.error = message;
            m.streaming = false;
          });
          setError(message);
        } else {
          patchAssistant(assistantId, (m) => {
            m.streaming = false;
          });
        }
      } finally {
        patchAssistant(assistantId, (m) => {
          m.streaming = false;
        });
        setStatus("idle");
        abortRef.current = null;
      }
    },
    [patchAssistant, status],
  );

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }, []);

  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionIdRef.current = null;
    setMessages([]);
    setStatus("idle");
    setSnapshot(null);
    setError(null);
    setProjectConflict(null);
  }, []);

  return { messages, status, snapshot, error, projectConflict, send, stop, reset };
}

interface ApplyContext {
  readonly patchAssistant: (id: string, update: (message: ChatMessage) => void) => void;
  readonly setStatus: (status: AgentStatus) => void;
  readonly setSnapshot: (snapshot: SessionSnapshot) => void;
  readonly setError: (error: string | null) => void;
  readonly setProjectConflict: (conflict: ProjectConflictNotice | null) => void;
  readonly sessionIdRef: { current: string | null };
}

function applyFrame(frame: AgentStreamFrame, assistantId: string, ctx: ApplyContext): void {
  switch (frame.type) {
    case "session":
      ctx.sessionIdRef.current = frame.sessionId;
      break;
    case "text_delta":
      ctx.setStatus("streaming");
      ctx.patchAssistant(assistantId, (m) => {
        m.text += frame.text;
      });
      break;
    case "thinking_delta":
      ctx.setStatus("thinking");
      ctx.patchAssistant(assistantId, (m) => {
        m.thinking = (m.thinking ?? "") + frame.text;
      });
      break;
    case "tool_start":
      ctx.setStatus("tool");
      ctx.patchAssistant(assistantId, (m) => {
        m.tools.push({
          toolCallId: frame.toolCallId,
          name: frame.name,
          label: frame.label,
          done: false,
          isError: false,
        });
      });
      break;
    case "tool_end":
      ctx.patchAssistant(assistantId, (m) => {
        const tool = m.tools.find((t) => t.toolCallId === frame.toolCallId);
        if (tool !== undefined) {
          tool.done = true;
          tool.isError = frame.isError;
          tool.summary = frame.summary;
        }
      });
      break;
    case "snapshot":
      ctx.setSnapshot(frame.snapshot);
      break;
    case "error":
      ctx.patchAssistant(assistantId, (m) => {
        m.error = frame.message;
      });
      ctx.setError(frame.message);
      if (frame.latestProject !== undefined) {
        ctx.setProjectConflict({
          action: "agent",
          message: frame.message,
          latestProject: frame.latestProject,
          occurredAt: new Date().toISOString(),
        });
      }
      break;
    case "done":
      break;
    default:
      break;
  }
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: AgentStreamFrame) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const frame = parseSseEvent(rawEvent);
      if (frame !== null) onFrame(frame);
      separator = buffer.indexOf("\n\n");
    }
  }
}

function parseSseEvent(rawEvent: string): AgentStreamFrame | null {
  const dataLines = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as AgentStreamFrame;
  } catch {
    return null;
  }
}

interface StreamErrorPayload {
  readonly message: string;
  readonly latestProject?: ProjectConflictNotice["latestProject"];
}

async function readErrorPayload(response: Response): Promise<StreamErrorPayload> {
  try {
    const payload = await response.json();
    if (!isRecord(payload) || !isRecord(payload.error)) {
      return { message: `Request failed (${response.status}).` };
    }

    const message =
      typeof payload.error.message === "string"
        ? payload.error.message
        : `Request failed (${response.status}).`;
    const latestProject = payload.error.latestProject;
    return {
      message,
      ...(isRecord(latestProject)
        ? { latestProject: latestProject as unknown as ProjectConflictNotice["latestProject"] }
        : {}),
    };
  } catch {
    return { message: `Request failed (${response.status}).` };
  }
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
