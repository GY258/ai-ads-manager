import type { ModelMessage } from "ai";

/**
 * The spec's fixed handoffs, enforced in code: models (gpt-5-nano, gemini-2.5-flash) sometimes reply
 * "Now I'll confirm the brand kit" without calling the tool, which dead-ends the flow. When the last message is a
 * successful result of a step with exactly one valid next step, the next model step must call that tool.
 * Everything else stays the agent's choice.
 */
const NEXT: Record<string, string> = {
  researchStore: "confirmBrandKit",
  confirmBrandKit: "planConcepts",
  planConcepts: "reviewConcepts",
  reviewConcepts: "generateAds",
};

export function requiredNextTool(messages: ModelMessage[]): string | null {
  const last = messages.at(-1);
  if (last?.role !== "tool") return null;
  for (const part of [...last.content].reverse()) {
    if (part.type !== "tool-result") continue;
    const out = part.output as { type: string; value?: unknown };
    const value = (out.type === "json" ? out.value : null) as { ok?: boolean; scope?: string; approved?: unknown[] } | null;
    if (!value || value.ok !== true) return null;
    if (part.toolName === "reviewConcepts" && !value.approved?.length) return null;
    if (part.toolName === "recordFeedback") return value.scope === "campaign" ? "planConcepts" : null;
    return NEXT[part.toolName] ?? null;
  }
  return null;
}
