import { structured } from "@/lib/adapters/llm";
import { brandSynthesisSchema, type BrandSynthesis } from "@/lib/agent/schemas";
import type { BrandSignals } from "@/lib/research/html-brand";

export type SynthesisProduct = { id: string; title: string; description: string | null; type: string | null };

const INSTRUCTIONS = `You are a brand strategist. From a store's homepage text and a sample of its products, infer the brand's
name, voice, value proposition, audience and tone. Pick up to 3 hero products that would make the strongest ads:
the brand's core product line, visually distinctive, not gift cards or accessories. Use only product ids from the list.`;

export async function synthesizeBrand(signals: BrandSignals, products: SynthesisProduct[]): Promise<{ object: BrandSynthesis; modelCalls: number }> {
  const prompt = [
    `Brand name (scraped): ${signals.name ?? "unknown"}`,
    signals.tagline && `Tagline: ${signals.tagline}`,
    signals.description && `Meta description: ${signals.description}`,
    `Homepage text:\n${signals.text.slice(0, 3000)}`,
    `Products:\n${products.map((p) => `- id: ${p.id} | ${p.title}${p.type ? ` [${p.type}]` : ""} — ${(p.description ?? "").slice(0, 160)}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await structured({
    role: "subagent",
    name: "brand-synthesis",
    schema: brandSynthesisSchema,
    instructions: INSTRUCTIONS,
    prompt,
    mock: () => ({
      name: signals.name ?? "Your Brand",
      voice: "playful, bold, upbeat",
      value_prop: signals.description?.split(/[.!]/)[0]?.trim() || "Products people love to use every day",
      audience: "young adults who live on their phones",
      tone_words: ["playful", "bold", "fun"],
      suggested_hero_product_ids: products.filter((p) => p.type === mostCommonType(products)).slice(0, 3).map((p) => p.id),
    }),
  });
  // The model may hallucinate ids: keep only real ones, fall back to the first products.
  const valid = new Set(products.map((p) => p.id));
  let hero = result.object.suggested_hero_product_ids.filter((id) => valid.has(id));
  if (!hero.length) hero = products.slice(0, 3).map((p) => p.id);
  return { ...result, object: { ...result.object, suggested_hero_product_ids: hero } };
}

function mostCommonType(products: SynthesisProduct[]): string | null {
  const counts = new Map<string | null, number>();
  for (const p of products) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** 10 products with images: half from the core (largest) product type, the rest spread round-robin. */
export function sampleForSynthesis<T extends { tags: string[]; images: unknown[] }>(products: T[], n = 10): T[] {
  const groups = new Map<string, T[]>();
  for (const p of products.filter((p) => p.images.length)) groups.set(p.tags[0] ?? "", [...(groups.get(p.tags[0] ?? "") ?? []), p]);
  const lists = [...groups.values()].sort((a, b) => b.length - a.length);
  const out: T[] = (lists[0] ?? []).slice(0, Math.ceil(n / 2));
  const rest = lists.map((l, i) => (i === 0 ? l.slice(out.length) : l));
  for (let i = 0; out.length < n && rest.some((l) => l[i]); i++) for (const l of rest) if (l[i] && out.length < n) out.push(l[i]);
  return out;
}
