import * as repo from "@/lib/db/repo";
import { getDb } from "@/lib/db/client";
import type { Layout } from "@/lib/db/types";
import { copySchema } from "@/lib/agent/schemas";
import { publicUrl } from "@/lib/storage";

/** Planned concepts for the review form, with the product photo each one will use. */
export async function getConcepts(campaignId: string, adIds: string[]) {
  const ads = await repo.listAds(campaignId);
  const out = [];
  for (const [i, a] of ads.entries()) {
    if (!adIds.includes(a.id)) continue;
    const img = await repo.getProductImage(a.product_image_id);
    const product = await repo.getProduct(a.product_id);
    out.push({
      id: a.id,
      number: i + 1,
      angle: a.angle,
      headline: a.headline,
      subhead: a.subhead,
      cta: a.cta,
      layout: a.layout,
      scene_prompt: a.scene_prompt,
      product: product?.title ?? "",
      image_url: img?.storage_path ? publicUrl(img.storage_path) : null,
      rendered: !!a.current_variant_id,
    });
  }
  return out;
}
export type ConceptView = Awaited<ReturnType<typeof getConcepts>>[number];

export type ConceptDecision = { id: string; keep: boolean; headline: string; subhead: string | null; cta: string; layout: Layout };

/** The user's final say on planned concepts: save edits, delete removed ones (never rendered ads). */
export async function finalizeConcepts(campaignId: string, decisions: ConceptDecision[]) {
  const errors: Record<string, string> = {};
  for (const d of decisions.filter((x) => x.keep)) {
    const r = copySchema.safeParse({ headline: d.headline, subhead: d.subhead || null, cta: d.cta });
    if (!r.success) errors[d.id] = r.error.issues.map((i) => i.message).join("; ");
  }
  if (Object.keys(errors).length) return { ok: false as const, errors };
  let edited = 0;
  let removed = 0;
  const ads = await repo.listAds(campaignId);
  for (const d of decisions) {
    const ad = ads.find((a) => a.id === d.id);
    if (!ad) continue;
    if (!d.keep) {
      if (!ad.current_variant_id) {
        await (await getDb()).query(`delete from ads where id = $1 and campaign_id = $2`, [d.id, campaignId]);
        removed++;
      }
      continue;
    }
    if (ad.headline !== d.headline || (ad.subhead ?? null) !== (d.subhead || null) || ad.cta !== d.cta || ad.layout !== d.layout) {
      await repo.updateAd(d.id, { headline: d.headline, subhead: d.subhead || null, cta: d.cta, layout: d.layout });
      edited++;
    }
  }
  const after = await repo.listAds(campaignId);
  const approved = after.map((a, i) => ({ id: a.id, number: i + 1, headline: a.headline })).filter((a) => decisions.some((d) => d.keep && d.id === a.id));
  await repo.insertEvent(campaignId, "concepts_reviewed", { approved: approved.length, removed, edited });
  return { ok: true as const, approved, removed, edited };
}
