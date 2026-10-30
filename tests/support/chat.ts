import { POST } from "@/app/api/chat/route";
import type { AppUIMessage } from "@/lib/agent/tools";

export type Chunk = { type: string; [k: string]: unknown };

/** Call the real route handler and parse the SSE UI message stream. */
export async function postChat(campaignId: string, messages: AppUIMessage[]) {
  const res = await POST(new Request("http://test/api/chat", { method: "POST", body: JSON.stringify({ campaignId, messages }) }));
  const raw = await res.text();
  const chunks: Chunk[] = raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => JSON.parse(l.slice(6)));
  return { res, raw, chunks };
}

export const userMsg = (text: string, id = crypto.randomUUID()): AppUIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });

/** Rebuild the assistant UI message from chunks (enough for tool-call/result + text parts). */
export function assistantFrom(chunks: Chunk[]): AppUIMessage {
  const start = chunks.find((c) => c.type === "start");
  const parts: Record<string, unknown>[] = [];
  const texts = new Map<string, { type: "text"; text: string }>();
  for (const c of chunks) {
    if (c.type === "text-start") texts.set(String(c.id), parts[parts.push({ type: "text", text: "" }) - 1] as { type: "text"; text: string });
    if (c.type === "text-delta") texts.get(String(c.id))!.text += String(c.delta);
    if (c.type === "tool-input-available") parts.push({ type: `tool-${c.toolName}`, toolCallId: c.toolCallId, state: "input-available", input: c.input });
    if (c.type === "tool-output-available") {
      const p = parts.find((x) => x.toolCallId === c.toolCallId)!;
      Object.assign(p, { state: "output-available", output: c.output });
    }
    if (c.type === "start-step") parts.push({ type: "step-start" });
    if (c.type.startsWith("data-")) parts.push({ type: c.type, id: c.id, data: c.data });
  }
  return { id: String(start?.messageId ?? crypto.randomUUID()), role: "assistant", parts } as AppUIMessage;
}

export const toolCalls = (chunks: Chunk[]) => chunks.filter((c) => c.type === "tool-input-available").map((c) => String(c.toolName));
export const text = (chunks: Chunk[]) => chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
