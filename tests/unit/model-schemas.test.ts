import { describe, expect, it } from "vitest";
import { z } from "zod";
import { planSchema } from "@/lib/agent/subagents/plan-concepts";
import { rewriteCopySchema } from "@/lib/agent/subagents/rewrite-copy";
import { brandSynthesisSchema } from "@/lib/agent/schemas";
import { sceneQaSchema } from "@/lib/pipeline/scene-qa";

/** OpenAI strict structured outputs: every object lists all its properties as required (use nullable, not optional). */
function strictViolations(node: unknown, path = "$"): string[] {
  if (!node || typeof node !== "object") return [];
  const n = node as { type?: string; properties?: Record<string, unknown>; required?: string[]; items?: unknown; anyOf?: unknown[] };
  const out: string[] = [];
  if (n.properties) {
    for (const k of Object.keys(n.properties)) if (!n.required?.includes(k)) out.push(`${path}.${k} not required`);
    for (const [k, v] of Object.entries(n.properties)) out.push(...strictViolations(v, `${path}.${k}`));
  }
  if (n.items) out.push(...strictViolations(n.items, `${path}[]`));
  for (const a of n.anyOf ?? []) out.push(...strictViolations(a, path));
  return out;
}

describe("subagent schemas work with OpenAI strict mode", () => {
  it.each([
    ["plan-concepts", planSchema],
    ["rewrite-copy", rewriteCopySchema],
    ["brand-synthesis", brandSynthesisSchema],
    ["scene-qa", sceneQaSchema],
  ] as const)("%s: every property is required", (_n, schema) => {
    expect(strictViolations(z.toJSONSchema(schema as z.ZodType))).toEqual([]);
  });
});
