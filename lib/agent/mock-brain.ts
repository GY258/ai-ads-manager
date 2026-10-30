import type { LanguageModelV4Prompt } from "@ai-sdk/provider";

export type MockPart = { type: "text"; text: string } | { type: "tool-call"; toolName: string; input: unknown };

/** Rule-based stand-in for the chat model. Phase 0: a fixed greeting. */
export function mockAgentTurn(prompt: LanguageModelV4Prompt): MockPart[] {
  void prompt;
  return [{ type: "text", text: "Hi! I'm running in mock mode. Paste a store URL to get started." }];
}
