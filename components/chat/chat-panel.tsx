"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import type { AppUIMessage, ProgressData } from "@/lib/agent/tools";
import { BrandKitForm } from "./brand-kit-form";
import { ConfirmedKit, ResearchSummary, ToolCard, type LooseToolPart } from "./tool-cards";
import { GenerationStrip } from "./generation-strip";

export function ChatPanel({ campaignId, storeUrl, initialMessages, onActivity }: { campaignId: string; storeUrl: string; initialMessages: AppUIMessage[]; onActivity?: () => void }) {
  const search = useSearchParams();
  const { messages, sendMessage, addToolOutput, status, error, regenerate } = useChat<AppUIMessage>({
    id: campaignId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { campaignId } }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onData: () => onActivity?.(),
    onFinish: () => onActivity?.(),
  });
  const [input, setInput] = useState("");
  const started = useRef(false);
  const busy = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (started.current || search.get("start") !== "1") return;
    started.current = true;
    // Drop ?start=1 without a router navigation (that would re-render the route and abort the stream).
    window.history.replaceState(null, "", `/c/${campaignId}`);
    if (initialMessages.length === 0) sendMessage({ text: `Make ads for ${storeUrl}` });
  }, [campaignId, initialMessages.length, search, sendMessage, storeUrl]);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Chat">
      <Conversation className="min-h-0">
        <ConversationContent className="gap-5">
          {messages.map((m) => {
            const progress = m.parts.filter((p): p is { type: "data-progress"; id?: string; data: ProgressData } => p.type === "data-progress").map((p) => p.data);
            return (
              <Message key={m.id} from={m.role}>
                <MessageContent className="w-full space-y-2">
                  {m.parts.map((p, i) => {
                    if (p.type === "text") return <MessageResponse key={i}>{p.text}</MessageResponse>;
                    if (!p.type.startsWith("tool-")) return null;
                    const part = p as unknown as LooseToolPart;
                    const mine = progress.filter((x) => x.toolCallId === part.toolCallId);
                    const output = part.state === "output-available" ? (part.output as Record<string, unknown>) : null;
                    if (part.type === "tool-confirmBrandKit") {
                      return (
                        <ToolCard key={part.toolCallId} part={part} progress={mine}>
                          {part.state === "input-available" && (
                            <BrandKitForm
                              campaignId={campaignId}
                              brandId={(part.input as { brandId: string }).brandId}
                              onConfirmed={(result) => addToolOutput({ tool: "confirmBrandKit", toolCallId: part.toolCallId, output: { ok: true, ...result } })}
                            />
                          )}
                          {output && <ConfirmedKit output={output} />}
                        </ToolCard>
                      );
                    }
                    return (
                      <ToolCard key={part.toolCallId} part={part} progress={mine}>
                        {part.type === "tool-researchStore" && output && <ResearchSummary output={output} />}
                        {(part.type === "tool-generateAds" || part.type === "tool-regenerateAd") && <GenerationStrip campaignId={campaignId} adIds={adIdsOf(part)} />}
                      </ToolCard>
                    );
                  })}
                </MessageContent>
              </Message>
            );
          })}
          {status === "submitted" && (
            <div className="text-sm text-muted-foreground">
              <Shimmer>Thinking…</Shimmer>
            </div>
          )}
          {error && (
            <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>The connection dropped. Your brand kit and ads are saved.</p>
              <Button size="sm" variant="outline" onClick={() => regenerate()}>
                Try again
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input aria-label="Message" value={input} onChange={(e) => setInput(e.target.value)} className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" placeholder="Tell the agent what to change…" />
        <Button type="submit" disabled={busy || !input.trim()}>
          Send
        </Button>
      </form>
    </section>
  );
}

function adIdsOf(part: { state: string; input?: unknown; output?: unknown }): string[] {
  const out = part.state === "output-available" ? (part.output as { ads?: { id: string }[]; adId?: string }) : null;
  if (out?.ads) return out.ads.map((a) => a.id);
  if (out?.adId) return [out.adId];
  return ((part.input as { adIds?: string[] })?.adIds ?? []).filter((x) => /^[0-9a-f-]{36}$/.test(x));
}
