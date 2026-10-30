import { z } from "zod";
import { structured } from "@/lib/adapters/llm";
import { COPY_LIMITS } from "@/lib/agent/schemas";
import { ZONE_PHRASE } from "@/lib/pipeline/scene-prompt";
import type { Angle, Layout } from "@/lib/db/types";

export const ANGLES = ["social_proof", "gift", "problem_solution", "lifestyle", "offer", "feature"] as const;
export const LAYOUTS = ["top_headline", "bottom_card", "split"] as const;

const conceptSchema = z.object({
  angle: z.enum(ANGLES),
  product_image_id: z.string(),
  headline: z.string(),
  subhead: z.string().nullish(),
  cta: z.string(),
  layout: z.enum(LAYOUTS),
  scene_prompt: z.string().describe("Describes the scene only. NO text. Names which area stays empty, matching the layout."),
});
export const planSchema = z.object({ concepts: z.array(conceptSchema) });
export type Concept = z.infer<typeof conceptSchema>;

export type PlanInput = {
  brand: { name: string; voice: string | null; value_prop: string | null; audience: string | null; colors: string[]; tone_words: string[] };
  products: { id: string; title: string; description: string | null; images: { id: string; width: number | null; height: number | null }[] }[];
  goal: string | null;
  offer: string | null;
  constraints: string[];
  feedback: string[];
  existingHeadlines: string[];
  count: number;
};

const INSTRUCTIONS = `You are a performance-marketing creative strategist planning 9:16 image ads.
For each concept pick an angle, one product_image_id from the list (never invent ids), short copy, a layout and a scene prompt.
Rules:
- Use at least 3 distinct angles across the set and spread concepts across the selected products.
- Headline ≤ ${COPY_LIMITS.headline} words, subhead ≤ ${COPY_LIMITS.subhead} words (optional), CTA ≤ ${COPY_LIMITS.cta} words. Specific beats generic.
- scene_prompt describes only the photo scene around the real product (setting, props, light, mood). It must contain NO text, letters or logos,
  and it must say which area stays empty for text, matching the layout: top_headline → top 32% empty; bottom_card → bottom 30% empty; split → top 22% and bottom 14% empty.
- Every constraint listed under "Constraints" is mandatory. Apply the recent feedback.
- Don't repeat existing headlines.`;

const clampWords = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(" ");

const ZONE_SHORT: Record<Layout, string> = { top_headline: "top 32%", bottom_card: "bottom 30%", split: "top 22% and bottom 14%" };

/** Enforce the spec's rules on whatever the model returned: real image ids, ≥3 angles, copy limits, zone named. */
export function normalizeConcepts(raw: Concept[], input: PlanInput): (Concept & { product_id: string })[] {
  const imageToProduct = new Map(input.products.flatMap((p) => p.images.map((i) => [i.id, p.id] as const)));
  const firstImages = input.products.map((p) => p.images[0]?.id).filter(Boolean) as string[];
  const out = raw.slice(0, input.count).map((c, i) => {
    const imageId = imageToProduct.has(c.product_image_id) ? c.product_image_id : firstImages[i % firstImages.length];
    const zone = ZONE_SHORT[c.layout];
    const scene = c.scene_prompt.toLowerCase().includes(zone.split(" ")[0]) && /empty/i.test(c.scene_prompt) ? c.scene_prompt : `${c.scene_prompt.trim().replace(/\.?$/, ".")} ${ZONE_PHRASE[c.layout]}`;
    return {
      ...c,
      product_image_id: imageId,
      product_id: imageToProduct.get(imageId)!,
      headline: clampWords(c.headline, COPY_LIMITS.headline),
      subhead: c.subhead ? clampWords(c.subhead, COPY_LIMITS.subhead) : null,
      cta: clampWords(c.cta, COPY_LIMITS.cta),
      scene_prompt: scene,
    };
  });
  // ≥ 3 distinct angles when there are ≥ 3 concepts: re-assign duplicates to unused angles.
  const need = Math.min(3, out.length);
  const used = new Set(out.map((c) => c.angle));
  for (let i = out.length - 1; used.size < need && i >= 0; i--) {
    const dupCount = out.filter((c) => c.angle === out[i].angle).length;
    if (dupCount < 2) continue;
    const fresh = ANGLES.find((a) => !used.has(a))!;
    out[i] = { ...out[i], angle: fresh };
    used.add(fresh);
  }
  return out;
}

const BANK: Record<Angle, { headline: string; subhead: string; cta: string; scene: string }[]> = {
  gift: [
    { headline: "The gift they'll actually use", subhead: "Wrapped, ready, and impossible to drop", cta: "Shop gifts", scene: "festive holiday table with wrapped gifts and warm fairy lights, product resting on kraft paper" },
    { headline: "Unwrap a better grip", subhead: "Stocking-stuffer sized, all-year useful", cta: "Gift it", scene: "cozy flat lay with ribbon and pine sprigs around the product" },
  ],
  lifestyle: [
    { headline: "Hands-free feels this good", subhead: "Loop in, scroll on, never fumble", cta: "Shop now", scene: "sunny cafe table lifestyle scene, product in a relaxed hand, playful soft light" },
    { headline: "Made for one-handed days", subhead: "Coffee in one hand, phone in the other", cta: "Get yours", scene: "city sidewalk lifestyle moment, product held casually, shallow depth of field" },
  ],
  social_proof: [
    { headline: "70,000 five-star reviews", subhead: "Join the people who stopped dropping", cta: "See why", scene: "clean studio shot, product centered on a soft pastel backdrop" },
    { headline: "Loved by serial droppers", subhead: "Rated 4.8 by real customers", cta: "Shop now", scene: "minimal pedestal with the product, soft shadow, pastel gradient" },
  ],
  problem_solution: [
    { headline: "Never drop your phone again", subhead: "A comfy loop that locks to your finger", cta: "Stop drops", scene: "dynamic studio scene, product mid-air being caught, motion blur props" },
    { headline: "Cracked screens are optional", subhead: "Grip that holds when you don't", cta: "Shop now", scene: "product over a tiled floor, dramatic top light" },
  ],
  feature: [
    { headline: "One loop. Total grip.", subhead: "Swap loops in seconds, keep the case", cta: "Learn more", scene: "macro detail of the product, studio light, smooth backdrop" },
    { headline: "Grip, reach, and stand", subhead: "The loop works three ways", cta: "Explore", scene: "product on a geometric pedestal with soft colored light" },
  ],
  offer: [
    { headline: "Your new favorite case, for less", subhead: "Limited-time pricing on bestsellers", cta: "Claim offer", scene: "bold color-block backdrop, product angled, clean shadows" },
  ],
};

/** Deterministic mock planner. Reads the same prompt the model gets, so constraints/feedback flow through. */
function mockPlan(prompt: string, input: PlanInput): { concepts: Concept[] } {
  const offset = input.existingHeadlines.length;
  const images = input.products.flatMap((p) => p.images.slice(0, 1).map((i) => i.id));
  const order: Angle[] = input.offer ? ["offer", "gift", "lifestyle", "social_proof", "problem_solution", "feature"] : ["gift", "lifestyle", "social_proof", "problem_solution", "feature", "gift"];
  const rules = prompt.match(/Constraints:\n([\s\S]*?)\n\n/)?.[1] ?? "";
  const calm = /busy|minimal|clean|simple|clutter/i.test(rules);
  const premium = /premium|dark|elegant|luxur/i.test(rules);
  return {
    concepts: Array.from({ length: input.count }, (_, i) => {
      const k = i + offset;
      const angle = order[k % order.length];
      const pick = BANK[angle][Math.floor(k / order.length) % BANK[angle].length];
      const layout = LAYOUTS[k % LAYOUTS.length];
      let scene = pick.scene;
      if (calm) scene = `clean minimal studio backdrop, product centered, no props`;
      if (premium) scene = `dark premium studio, moody low-key light, ${calm ? "no props" : "single elegant prop"}`;
      return {
        angle,
        product_image_id: images[k % images.length],
        headline: premium ? pick.headline.replace(/!$/, "") : pick.headline,
        subhead: pick.subhead,
        cta: pick.cta,
        layout,
        scene_prompt: `${scene}. Leave the ${ZONE_SHORT[layout]} of the frame empty.`,
      };
    }),
  };
}

export async function planConcepts(input: PlanInput) {
  const prompt = [
    `Brand: ${input.brand.name}. Voice: ${input.brand.voice}. Value: ${input.brand.value_prop}. Audience: ${input.brand.audience}. Tone: ${input.brand.tone_words.join(", ")}. Colors: ${input.brand.colors.join(", ")}.`,
    `Goal: ${input.goal ?? "general"}. Offer: ${input.offer || "none"}.`,
    `Products:\n${input.products.map((p) => `- ${p.title}: ${(p.description ?? "").slice(0, 200)}\n  images: ${p.images.map((i) => `image_id: ${i.id} (${i.width ?? "?"}×${i.height ?? "?"})`).join(", ")}`).join("\n")}`,
    `Constraints:\n${input.constraints.length ? input.constraints.map((c) => `- ${c}`).join("\n") : "- none"}`,
    `Recent feedback:\n${input.feedback.length ? input.feedback.map((f) => `- ${f}`).join("\n") : "- none"}`,
    `Existing headlines: ${input.existingHeadlines.join(" | ") || "none"}`,
    `Plan exactly ${input.count} concepts.`,
  ].join("\n\n");
  const r = await structured({ role: "subagent", name: "plan-concepts", schema: planSchema, instructions: INSTRUCTIONS, prompt, mock: (p) => mockPlan(p, input) });
  return { concepts: normalizeConcepts(r.object.concepts, input), modelCalls: r.modelCalls };
}
