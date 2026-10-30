import { z } from "zod";
import * as repo from "@/lib/db/repo";
import { planConcepts as planSubagent } from "@/lib/agent/subagents/plan-concepts";
import { copyProductImage } from "@/lib/research/copy-images";
import { renderVariant } from "@/lib/pipeline/render-variant";
import { publicUrl } from "@/lib/storage";
import { mapLimit } from "@/lib/util";
import { runTool, ToolError } from "./run";
import type { ToolContext } from "./types";

export const MAX_ADS_PER_CALL = 6;

async function confirmedContext(campaignId: string) {
  const campaign = await repo.getCampaign(campaignId);
  if (!campaign) throw new ToolError("Campaign not found.", "retry");
  const brand = campaign.brand_id ? await repo.getBrand(campaign.brand_id) : null;
  if (!brand || brand.status !== "confirmed") throw new ToolError("The brand kit isn't confirmed yet.", "confirm_brand_kit_first");
  if (!campaign.product_ids.length) throw new ToolError("No products are selected for this campaign.", "confirm_brand_kit_first");
  return { campaign, brand };
}

export const planConceptsInput = z.object({
  campaignId: z.string(),
  count: z.number().int().min(1).max(12).default(6),
});

export async function planConcepts(input: z.infer<typeof planConceptsInput>, ctx: ToolContext) {
  return runTool("planConcepts", ctx.campaignId, input, async () => {
    const { campaign, brand } = await confirmedContext(ctx.campaignId);
    ctx.progress(`Planning ${input.count} concepts`);
    const products = (await Promise.all(campaign.product_ids.map((id) => repo.getProduct(id)))).filter((p) => !!p);
    // Only images that are in our Storage can be used as references.
    for (const p of products) p.images = (await mapLimit(p.images.slice(0, 2), 2, (img) => copyProductImage(brand.id, img).catch(() => null))).filter((x) => !!x);
    const usable = products.filter((p) => p.images.length);
    if (!usable.length) throw new ToolError("None of the selected products have usable photos.", "ask_for_product_urls_or_upload");
    const existing = await repo.listAds(campaign.id);
    const feedback = (await repo.recentFeedback(campaign.id, 5)).map((f) => f.text);
    const { concepts, modelCalls } = await planSubagent({
      brand: { name: brand.name ?? brand.domain, voice: brand.voice, value_prop: brand.value_prop, audience: brand.audience, colors: brand.colors, tone_words: brand.tone_words },
      products: usable.map((p) => ({ id: p.id, title: p.title, description: p.description, images: p.images.map((i) => ({ id: i.id, width: i.width, height: i.height })) })),
      goal: campaign.goal,
      offer: campaign.offer,
      constraints: campaign.constraints,
      feedback,
      existingHeadlines: existing.map((a) => a.headline),
      count: input.count,
    });
    const ads = await repo.insertAds(campaign.id, concepts);
    return {
      result: {
        ads: ads.map((a, i) => ({ id: a.id, number: existing.length + i + 1, angle: a.angle, headline: a.headline, layout: a.layout })),
        angles: [...new Set(ads.map((a) => a.angle))],
      },
      modelCalls,
    };
  });
}

export const generateAdsInput = z.object({
  campaignId: z.string(),
  adIds: z.array(z.string()).optional().describe("Ad ids or numbers. Default: every ad without a finished image. Max 6 per call."),
});

export async function generateAds(input: z.infer<typeof generateAdsInput>, ctx: ToolContext) {
  return runTool("generateAds", ctx.campaignId, input, async () => {
    const { campaign } = await confirmedContext(ctx.campaignId);
    const all = await repo.listAds(campaign.id);
    let targets = all;
    if (input.adIds?.length) {
      const resolved = await Promise.all(input.adIds.map((r) => repo.resolveAdRef(campaign.id, r)));
      targets = resolved.filter((x) => !!x).map((x) => x.ad);
    } else {
      targets = all.filter((a) => !a.current_variant_id);
    }
    if (!targets.length) throw new ToolError("There are no ads waiting to be rendered. Plan new concepts first.", "none");
    const batch = targets.slice(0, MAX_ADS_PER_CALL);
    const remaining = targets.length - batch.length;
    let done = 0;
    ctx.progress(`Rendering ${batch.length} ads`);
    let modelCalls = 0;
    const results = await mapLimit(batch, 3, async (ad) => {
      const r = await renderVariant(ad.id, { mode: "full", progress: ctx.progress });
      modelCalls += r.modelCalls;
      ctx.progress(`Rendered ad ${++done}/${batch.length}`);
      return r;
    });
    const ads = results.map((r) => ({
      id: r.variant?.ad_id ?? "",
      number: r.adNumber,
      status: r.ok ? "ready" : "failed",
      fallback: r.ok ? r.fallback : false,
      qa_status: r.ok ? r.qaStatus : "fail",
      final_url: r.ok && r.variant.final_path ? publicUrl(r.variant.final_path) : null,
      error: r.ok ? undefined : r.reason,
    }));
    const tooLong = results.filter((r) => !r.ok && r.reason === "copy_too_long").map((r) => r.adNumber);
    return {
      result: {
        ads,
        summary: { ready: ads.filter((a) => a.status === "ready").length, fallback: ads.filter((a) => a.fallback).length, failed: ads.filter((a) => a.status === "failed").length },
        too_long: tooLong,
        remaining,
        note: tooLong.length ? `Headlines for ads ${tooLong.map((n) => `#${n}`).join(", ")} are too long to render legibly — propose 3 shorter options.` : remaining ? `${remaining} more ads to render — call generateAds again.` : undefined,
      },
      modelCalls,
    };
  });
}
