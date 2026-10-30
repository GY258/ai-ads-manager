import { after } from "next/server";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, generateId, isStepCount, streamText, toUIMessageStream } from "ai";
import { chatModel, modelId, speedOptions } from "@/lib/adapters/llm";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import { buildTools, type AppUIMessage } from "@/lib/agent/tools";
import * as repo from "@/lib/db/repo";
import { closeInterruptedToolCalls } from "@/lib/agent/transcript";

export const maxDuration = 300;

export async function POST(req: Request) {
  const body: { messages: AppUIMessage[]; campaignId?: string } = await req.json();
  const campaignId = body.campaignId;
  const messages = closeInterruptedToolCalls(body.messages);
  if (!campaignId || !(await repo.getCampaign(campaignId))) return Response.json({ error: "unknown campaign" }, { status: 404 });

  // Postgres is the source of truth: save what the client sent (user message, HITL results) before anything risky.
  await repo.saveMessages(campaignId, messages);
  const instructions = await buildSystemPrompt(campaignId);

  const stream = createUIMessageStream<AppUIMessage>({
    originalMessages: messages,
    generateId,
    execute: async ({ writer }) => {
      const tools = buildTools(campaignId, writer);
      const result = streamText({
        model: chatModel(),
        instructions,
        messages: await convertToModelMessages(messages, { tools }),
        tools,
        stopWhen: isStepCount(8),
        providerOptions: speedOptions(modelId("chat")),
      });
      writer.merge(toUIMessageStream({ stream: result.stream, sendReasoning: false }));
    },
    onError: (e) => {
      console.error("[chat]", e);
      return "Something went wrong on our side. Your ads and brand kit are saved — send your message again to continue.";
    },
    onEnd: async ({ messages: all }) => {
      await repo.saveMessages(campaignId, all);
    },
  });

  // Tee: one branch to the browser, one drained here so tools and persistence finish even if the tab closes.
  const [toClient, toServer] = stream.tee();
  const drain = async () => {
    const reader = toServer.getReader();
    while (!(await reader.read()).done) {
      /* drain */
    }
  };
  try {
    after(drain);
  } catch {
    void drain(); // outside a Next request scope (route tests)
  }
  return createUIMessageStreamResponse({ stream: toClient });
}
