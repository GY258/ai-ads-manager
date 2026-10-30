import { generateText, Output, simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4Prompt, LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import type { z } from "zod";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { mockAgentTurn } from "@/lib/agent/mock-brain";

export type ModelRole = "chat" | "subagent" | "qa";

const USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

/** Every mock model call lands here so tests can assert on prompts (e.g. feedback reaching planConcepts). */
export const mockCalls: { role: ModelRole; name: string; prompt: string }[] = [];

export function promptText(prompt: LanguageModelV4Prompt): string {
  return prompt
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content.map((p) => ("text" in p ? p.text : p.type === "tool-result" ? JSON.stringify(p.output) : "")).join("\n"),
    )
    .join("\n");
}

/** Reasoning models (gpt-5*) default to slow, long thinking; these calls are short and structured. */
export function speedOptions(model: string) {
  return /^openai\/gpt-5/.test(model) ? { openai: { reasoningEffort: "minimal" } } : undefined;
}

export function modelId(role: ModelRole) {
  const e = env();
  return role === "chat" ? e.CHAT_MODEL : role === "subagent" ? e.SUBAGENT_MODEL : e.QA_MODEL;
}

/** The main agent's model. Mock mode plays a rule-based script (lib/agent/mock-brain.ts). */
export function chatModel(): LanguageModel {
  if (env().AI_MODE === "mock") {
    return new MockLanguageModelV4({
      doStream: async ({ prompt, tools }) => {
        mockCalls.push({ role: "chat", name: "agent", prompt: promptText(prompt) });
        const parts = mockAgentTurn(prompt, (tools ?? []).map((t) => t.name));
        const chunks: LanguageModelV4StreamPart[] = [];
        for (const p of parts) {
          if (p.type === "text") {
            const id = `t${chunks.length}`;
            chunks.push({ type: "text-start", id });
            for (const word of p.text.split(/(?<= )/)) chunks.push({ type: "text-delta", id, delta: word });
            chunks.push({ type: "text-end", id });
          } else {
            chunks.push({ type: "tool-call", toolCallId: `call_${crypto.randomUUID().slice(0, 8)}`, toolName: p.toolName, input: JSON.stringify(p.input) });
          }
        }
        const calledTool = parts.some((p) => p.type === "tool-call");
        chunks.push({ type: "finish", finishReason: { unified: calledTool ? "tool-calls" : "stop", raw: undefined }, usage: USAGE });
        return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 5 }) };
      },
    });
  }
  return modelId("chat");
}

type StructuredArgs<T> = {
  role: Exclude<ModelRole, "chat">;
  /** Stable name for logs, cache keys and mock scripts. */
  name: string;
  schema: z.ZodType<T>;
  instructions: string;
  prompt: string;
  images?: { data: Uint8Array; mediaType: string }[];
  /** Deterministic answer used in mock mode. Receives the full prompt text. */
  mock: (promptText: string) => T;
};

/**
 * One focused structured call: the shape of every "subagent".
 * mock → scripted; replay → model_cache lookup, live on miss; live → AI Gateway.
 */
export async function structured<T>(args: StructuredArgs<T>): Promise<{ object: T; modelCalls: number }> {
  const e = env();
  if (e.AI_MODE === "mock") {
    const text = `${args.instructions}\n${args.prompt}`;
    mockCalls.push({ role: args.role, name: args.name, prompt: text });
    const object = args.schema.parse(args.mock(text));
    return { object, modelCalls: 0 };
  }
  const key = createHash("sha256")
    .update(JSON.stringify([args.name, modelId(args.role), args.instructions, args.prompt, args.images?.map((i) => createHash("sha1").update(i.data).digest("hex"))]))
    .digest("hex");
  if (e.AI_MODE === "replay") {
    const { cacheGet } = await import("@/lib/db/repo");
    const hit = await cacheGet(key);
    if (hit) return { object: args.schema.parse(hit), modelCalls: 0 };
  }
  const content: ({ type: "text"; text: string } | { type: "file"; data: Uint8Array; mediaType: string })[] = [{ type: "text", text: args.prompt }];
  for (const img of args.images ?? []) content.push({ type: "file", data: img.data, mediaType: img.mediaType });
  const result = await generateText({
    model: modelId(args.role),
    instructions: args.instructions,
    messages: [{ role: "user", content }],
    output: Output.object({ schema: args.schema }),
    providerOptions: speedOptions(modelId(args.role)),
  });
  const object = result.output as T;
  if (e.AI_MODE === "replay") {
    const { cachePut } = await import("@/lib/db/repo");
    await cachePut(key, object);
  }
  return { object, modelCalls: 1 };
}
