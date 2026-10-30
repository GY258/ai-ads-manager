import * as repo from "@/lib/db/repo";
import type { Variant } from "@/lib/db/types";
import { publicUrl } from "@/lib/storage";

export function variantView(v: Variant) {
  return {
    id: v.id,
    parent_variant_id: v.parent_variant_id,
    status: v.status,
    layout: v.layout,
    copy: v.copy,
    model: v.model,
    error: v.error,
    qa_status: v.qa_status,
    qa: v.qa,
    final_url: v.final_path ? publicUrl(v.final_path) : null,
    scene_url: v.scene_path ? publicUrl(v.scene_path) : null,
    created_at: v.created_at,
  };
}
export type VariantView = ReturnType<typeof variantView>;

/** Everything the canvas renders. Read by polling; no model calls. */
export async function getCampaignView(campaignId: string) {
  const campaign = await repo.getCampaign(campaignId);
  if (!campaign) return null;
  const brand = campaign.brand_id ? await repo.getBrand(campaign.brand_id) : null;
  const ads = await repo.listAds(campaignId);
  const variants = await repo.listCampaignVariants(campaignId);
  const byId = new Map(variants.map((v) => [v.id, v]));
  const latestByAd = new Map<string, Variant>();
  for (const v of variants) latestByAd.set(v.ad_id, v);
  return {
    campaign: { id: campaign.id, name: campaign.name, goal: campaign.goal, offer: campaign.offer, constraints: campaign.constraints, status: campaign.status, store_url: campaign.store_url },
    brand: brand && {
      id: brand.id,
      name: brand.name ?? brand.domain,
      status: brand.status,
      logo_url: brand.logo_path ? publicUrl(brand.logo_path) : null,
      colors: brand.colors,
      fonts: brand.fonts,
      voice: brand.voice,
    },
    ads: ads.map((a, i) => {
      const current = (a.current_variant_id && byId.get(a.current_variant_id)) || latestByAd.get(a.id) || null;
      // A newer in-flight variant shows as "rendering" on top of the current one.
      const latest = latestByAd.get(a.id);
      const pending = latest && latest.id !== current?.id && !["ready", "failed"].includes(latest.status) ? latest : null;
      return {
        id: a.id,
        number: i + 1,
        status: a.status,
        angle: a.angle,
        headline: a.headline,
        subhead: a.subhead,
        cta: a.cta,
        layout: a.layout,
        current: current ? variantView(current) : null,
        pending: pending ? variantView(pending) : null,
        variant_count: variants.filter((v) => v.ad_id === a.id).length,
      };
    }),
    inflight: variants.some((v) => !["ready", "failed"].includes(v.status)),
  };
}
export type CampaignView = NonNullable<Awaited<ReturnType<typeof getCampaignView>>>;
export type AdView = CampaignView["ads"][number];
