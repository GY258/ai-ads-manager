import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { requiredNextTool } from "@/lib/agent/flow";

const result = (toolName: string, value: unknown): ModelMessage[] => [
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName, output: { type: "json", value: value as never } }] },
];

describe("required next tool", () => {
  it("forces the fixed handoffs after successful steps", () => {
    expect(requiredNextTool(result("researchStore", { ok: true }))).toBe("confirmBrandKit");
    expect(requiredNextTool(result("confirmBrandKit", { ok: true }))).toBe("planConcepts");
    expect(requiredNextTool(result("planConcepts", { ok: true }))).toBe("generateAds");
    expect(requiredNextTool(result("recordFeedback", { ok: true, scope: "campaign" }))).toBe("planConcepts");
  });
  it("leaves the agent free after failures, ad-level feedback, and user messages", () => {
    expect(requiredNextTool(result("researchStore", { ok: false, fallback: "ask_for_valid_url" }))).toBeNull();
    expect(requiredNextTool(result("recordFeedback", { ok: true, scope: "ad" }))).toBeNull();
    expect(requiredNextTool(result("generateAds", { ok: true }))).toBeNull();
    expect(requiredNextTool([{ role: "user", content: "hi" }])).toBeNull();
  });
});
