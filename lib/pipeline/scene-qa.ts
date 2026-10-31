import { z } from "zod";
import { structured } from "@/lib/adapters/llm";
import { ZONE_PHRASE } from "./scene-prompt";
import type { Layout } from "@/lib/compose/contrast";

export const sceneQaSchema = z.object({
  product_match: z.enum(["pass", "warn", "fail"]).describe("same shape, color and print as the reference"),
  text_zone_clean: z.boolean().describe("the empty zone is really empty"),
  stray_text: z.boolean().describe("the model drew letters or fake logos"),
  extra_products: z.boolean(),
  issues: z.array(z.string()),
});
export type SceneQa = z.infer<typeof sceneQaSchema>;
export type QaOutcome = "pass" | "warn" | "retry";

/** pass → all clear; warn → minor (badge); retry → product mismatch, stray text or a dirty zone. */
export function classify(qa: SceneQa): QaOutcome {
  if (qa.product_match === "fail" || qa.stray_text || !qa.text_zone_clean) return "retry";
  if (qa.product_match === "warn" || qa.extra_products || qa.issues.length) return "warn";
  return "pass";
}

const SCRIPT: Record<string, SceneQa> = {
  pass: { product_match: "pass", text_zone_clean: true, stray_text: false, extra_products: false, issues: [] },
  warn: { product_match: "pass", text_zone_clean: true, stray_text: false, extra_products: false, issues: ["background slightly busy near the text zone"] },
  product_fail: { product_match: "fail", text_zone_clean: true, stray_text: false, extra_products: false, issues: ["case print differs from the reference (stripes became dots)"] },
  zone_fail: { product_match: "pass", text_zone_clean: false, stray_text: false, extra_products: false, issues: ["props intrude into the empty text zone"] },
  text_fail: { product_match: "pass", text_zone_clean: true, stray_text: true, extra_products: false, issues: ["model drew fake lettering on the background"] },
};

/** Scripted mock QA: MOCK_QA_SCRIPT="product_fail,pass" answers call 1, call 2, … (last value repeats). */
let scriptIndex = 0;
export const qaCalls: { layout: Layout }[] = [];
export function resetMockQa() {
  scriptIndex = 0;
  qaCalls.length = 0;
}

export async function runSceneQa(a: { scene: Uint8Array; reference: Uint8Array; referenceType: string; layout: Layout }): Promise<{ qa: SceneQa; modelCalls: number }> {
  qaCalls.push({ layout: a.layout });
  const r = await structured({
    role: "qa",
    name: "scene-qa",
    schema: sceneQaSchema,
    instructions: `You check AI-generated ad scenes before text is added. Image 1 is the generated scene, image 2 is the real product photo.
product_match: compare shape and parts (straps, rings, holders, cutouts), print and the product's own logo. Before calling a part missing or extra, look at image 2 again: only report it if it really differs. Color fails only for a clearly different hue (pink → purple, black → silver); shifts from lighting or shadow are at most "warn".
stray_text: only letters, numbers or logo-like marks the model ADDED (on the background, props or the product where the reference has none). The product's own logo or print that also appears in image 2 is NOT stray text.
text_zone_clean: the text zone holds only smooth background; ignore the product's own logo when judging it.`,
    prompt: `Text zone for this layout: ${ZONE_PHRASE[a.layout]} List concrete issues (short phrases a prompt can fix).`,
    images: [
      { data: a.scene, mediaType: "image/png" },
      { data: a.reference, mediaType: a.referenceType },
    ],
    mock: () => {
      const steps = (process.env.MOCK_QA_SCRIPT ?? "pass").split(",").map((s) => s.trim());
      const step = steps[Math.min(scriptIndex++, steps.length - 1)];
      return SCRIPT[step] ?? SCRIPT.pass;
    },
  });
  return { qa: r.object, modelCalls: r.modelCalls };
}
