import { AlertCircle } from "lucide-react";
import type { ChatMessage } from "./useAgentStream.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { ToolActivity } from "./ToolActivity.js";
import { cn } from "../lib/utils.js";

export interface MessageBubbleProps {
  readonly message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[85%] flex-col gap-2", isUser ? "items-end" : "items-start")}>
        {!isUser && message.tools.length > 0 && <ToolActivity tools={message.tools} />}
        {(message.text.length > 0 || message.streaming === true) && (
          <div
            className={cn(
              "break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
              isUser
                ? "whitespace-pre-wrap rounded-br-sm bg-primary text-primary-foreground"
                : "rounded-bl-sm border bg-card text-card-foreground",
            )}
          >
            {isUser ? message.text : <MarkdownContent content={message.text} />}
            {message.streaming === true && message.text.length === 0 && (
              <span className="text-muted-foreground">Thinking…</span>
            )}
            {message.streaming === true && message.text.length > 0 && (
              <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-blink rounded-sm bg-current align-baseline" />
            )}
          </div>
        )}
        {message.error !== undefined && (
          <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{message.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
