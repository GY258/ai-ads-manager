import type { AppUIMessage } from "./tools";

/**
 * A stream that died mid-tool (timeout, deploy, closed tab) leaves a server tool call without a result, and the
 * model API rejects such a transcript. Close those calls as errors so the conversation can always continue.
 * confirmBrandKit is exempt: it legitimately waits for the user.
 */
export function closeInterruptedToolCalls(messages: AppUIMessage[]): AppUIMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    return {
      ...m,
      parts: m.parts.map((p) => {
        const part = p as { type: string; state?: string };
        if (!part.type.startsWith("tool-") || part.type === "tool-confirmBrandKit") return p;
        if (part.state !== "input-available" && part.state !== "input-streaming") return p;
        return { ...p, state: "output-error", errorText: "Interrupted before it finished. Results already saved are on the canvas; ask to retry the rest." } as typeof p;
      }),
    };
  });
}
