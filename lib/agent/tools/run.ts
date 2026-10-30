import { logToolRun } from "@/lib/db/repo";
import type { ToolFail, ToolResult } from "./types";

export class ToolError extends Error {
  constructor(message: string, readonly fallback: ToolFail["fallback"], readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

/**
 * Wraps every tool step: never throws to the agent, always logs a tool_runs row.
 * `fn` returns the ok payload plus how many model calls it made.
 */
export async function runTool<T extends object>(
  tool: string,
  campaignId: string | null,
  input: unknown,
  fn: () => Promise<{ result: T; modelCalls?: number }>,
): Promise<ToolResult<T>> {
  const started = Date.now();
  let out: ToolResult<T>;
  let modelCalls = 0;
  let error: string | null = null;
  try {
    const r = await fn();
    modelCalls = r.modelCalls ?? 0;
    out = { ok: true, ...r.result };
  } catch (e) {
    error = (e as Error).message;
    const fallback = e instanceof ToolError ? e.fallback : "retry";
    const extra = e instanceof ToolError ? e.extra : {};
    if (!(e instanceof ToolError)) console.error(`[tool ${tool}]`, e);
    out = { ok: false, error: friendly(error), fallback, ...extra };
  }
  await logToolRun({ tool, campaign_id: campaignId, input, output: out, error, duration_ms: Date.now() - started, model_calls: modelCalls }).catch((e) => console.error("tool_runs log failed", e));
  return out;
}

function friendly(msg: string) {
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}
