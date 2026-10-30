"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";

export function ChatPanel({ campaignId }: { campaignId: string }) {
  const { messages, sendMessage, status } = useChat({
    id: campaignId,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { campaignId } }),
  });
  const [input, setInput] = useState("");
  return (
    <section className="flex w-full max-w-[420px] flex-col border-r">
      <Conversation>
        <ConversationContent>
          {messages.map((m) => (
            <Message key={m.id} from={m.role}>
              <MessageContent>
                {m.parts.map((p, i) => (p.type === "text" ? <MessageResponse key={i}>{p.text}</MessageResponse> : null))}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input aria-label="Message" value={input} onChange={(e) => setInput(e.target.value)} className="h-10 flex-1 rounded-md border px-3 text-sm" placeholder="Message the agent" />
        <Button type="submit" disabled={status === "streaming" || status === "submitted"}>
          Send
        </Button>
      </form>
    </section>
  );
}
