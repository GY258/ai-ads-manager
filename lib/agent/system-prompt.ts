import * as repo from "@/lib/db/repo";
import { COPY_LIMITS } from "./schemas";

export const BASE_PROMPT = `You are a performance-marketing creative strategist working for the user, inside an AI ads manager.
The user's ads appear on a canvas next to this chat, so keep replies short and concrete (1-3 sentences). Never describe images at length.

Flow: store URL → researchStore → confirmBrandKit → planConcepts → generateAds → review loop.
- Never generate or plan ads before the brand kit is confirmed (brand status "confirmed").
- Never invent a product. Every ad must use a product_image_id that exists in the database; planConcepts handles this.
- Act, don't just describe: when the user asks for a change or more ads, call the tool in the same turn. Never end a turn with "I'll do X" without having called the tool for X. Don't ask permission for routine actions.
- Turn vague feedback into specific changes before regenerating ("more premium" → darker palette, minimal props, serif headline) and say in one line what will change.
  Campaign-wide feedback → recordFeedback with concrete constraints, then planConcepts/generateAds. Feedback on one ad → regenerateAd.
- Copy limits: headline ≤ ${COPY_LIMITS.headline} words, subhead ≤ ${COPY_LIMITS.subhead} words, CTA ≤ ${COPY_LIMITS.cta} words.
- Ads are referred to by number (#1, #2…) as shown on the canvas; pass that number as adId.
- generateAds renders at most 6 ads per call; call it again for more.
- Unless the user asks for a number, call planConcepts without a count (the app picks the default batch size).
- When a tool returns ok: false, explain the problem in one sentence and offer the fallback it suggests. Never stop at the error.
  Fallbacks: ask_for_valid_url → ask for a working store URL (example: www.loopycases.com); ask_for_product_urls_or_upload → ask for product page URLs or a photo upload;
  shorten_copy → propose 3 shorter headline options; product_hero_template → the ad was made from the real product photo instead, offer a retry; retry → offer to try again.`;

const approxTokens = (s: string) => Math.ceil(s.length / 4);

/** ~300-token snapshot of the campaign, appended to the system prompt on every request. */
export async function buildStateSummary(campaignId: string): Promise<string> {
  const campaign = await repo.getCampaign(campaignId);
  if (!campaign) return `Campaign id: ${campaignId} (not found).`;
  const lines = [`Campaign id: ${campaign.id}. Store URL: ${campaign.store_url}.`];
  const brand = campaign.brand_id ? await repo.getBrand(campaign.brand_id) : null;
  if (!brand) {
    lines.push("Brand: not researched yet — call researchStore with the store URL.");
  } else {
    lines.push(`Brand: ${brand.name ?? brand.domain} (${brand.status}, id ${brand.id}). Voice: ${brand.voice ?? "?"}. Colors: ${brand.colors.slice(0, 3).join(", ")}. Font: ${brand.fonts[0] ?? "?"}.`);
  }
  if (campaign.goal || campaign.product_ids.length) {
    lines.push(`Campaign goal: ${campaign.goal ?? "not set"}, offer: ${campaign.offer || "none"}.`);
    const products = await Promise.all(campaign.product_ids.map((id) => repo.getProduct(id)));
    lines.push(`Products selected: ${products.filter(Boolean).map((p) => p!.title).join("; ") || "none"}.`);
  }
  const ads = await repo.listAds(campaignId);
  if (ads.length) {
    const c = await repo.adCounts(campaignId);
    lines.push(`Ads: ${c.total} total; ${c.approved} approved, ${c.rejected} rejected, ${c.draft} draft.`);
    const variants = await repo.listCampaignVariants(campaignId);
    const inflight = variants.filter((v) => !["ready", "failed"].includes(v.status)).length;
    const failed = ads.filter((a) => variants.find((v) => v.id === a.current_variant_id)?.status === "failed").length;
    if (inflight || failed) lines.push(`Rendering: ${inflight} in progress, ${failed} failed.`);
    const recent = ads.map((a, i) => ({ a, n: i + 1 })).slice(-8);
    lines.push(`Latest ads: ${recent.map(({ a, n }) => `#${n} ${a.status} ${a.angle} "${a.headline}"`).join("; ")}.`);
  }
  if (campaign.constraints.length) lines.push(`Open constraints: ${campaign.constraints.slice(-6).join("; ")}.`);
  const fb = await repo.recentFeedback(campaignId, 1);
  if (fb[0]) lines.push(`Latest feedback: "${fb[0].text.slice(0, 120)}".`);
  const events = await repo.recentEvents(campaignId, 5);
  if (events.length) lines.push(`Recent canvas actions: ${events.map((e) => describeEvent(e.type, e.payload)).join("; ")}.`);
  let out = lines.join("\n");
  while (approxTokens(out) > 380 && lines.length > 3) {
    lines.splice(lines.length - 2, 1);
    out = lines.join("\n");
  }
  return out;
}

export function describeEvent(type: string, p: Record<string, unknown>): string {
  const ad = p.adNumber ? `ad #${p.adNumber}` : "an ad";
  switch (type) {
    case "ad_status":
      return `user ${p.status === "approved" ? "approved" : p.status === "rejected" ? "rejected" : "reset"} ${ad}`;
    case "ad_copy_edited":
      return `user edited ${ad} ${Object.keys((p.fields as object) ?? {}).join("/") || "copy"}`;
    case "ad_regenerated":
      return `user regenerated ${ad} (${p.scope})`;
    case "variant_restored":
      return `user restored an older version of ${ad}`;
    case "brand_kit_confirmed":
      return "user confirmed the brand kit";
    default:
      return type;
  }
}

export async function buildSystemPrompt(campaignId: string) {
  return `${BASE_PROMPT}\n\nCurrent state:\n${await buildStateSummary(campaignId)}`;
}

export { approxTokens };
