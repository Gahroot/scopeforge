import { useEffect, useRef } from "react";
import { ScrollArea } from "../components/ui/scroll-area.js";
import { MessageBubble } from "./MessageBubble.js";
import type { ChatMessage } from "./useAgentStream.js";

export interface MessageListProps {
  readonly messages: readonly ChatMessage[];
}

export function MessageList({ messages }: MessageListProps): JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
