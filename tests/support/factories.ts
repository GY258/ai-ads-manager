import * as repo from "@/lib/db/repo";
import { researchStore } from "@/lib/agent/tools/research-store";
import type { Progress } from "@/lib/agent/tools/types";

export function captureProgress() {
  const messages: string[] = [];
  const progress: Progress = (m) => void messages.push(m);
  return { messages, progress };
}

export async function newCampaign(url = "https://www.loopycases.com") {
  return repo.createCampaign(url, new URL(url).hostname);
}

/** Research Loopy from fixtures and return the campaign + research result. */
export async function researchedCampaign(url = "https://www.loopycases.com") {
  const campaign = await newCampaign(url);
  const { progress, messages } = captureProgress();
  const result = await researchStore({ url }, { campaignId: campaign.id, progress });
  if (!result.ok) throw new Error(`research failed: ${result.error}`);
  return { campaign, result, messages };
}

/** Researched + confirmed Loopy campaign with the first `n` hero products selected. */
export async function confirmedCampaign(n = 2) {
  const { campaign } = await researchedCampaign();
  const { confirmBrandKit } = await import("@/lib/campaign/brand-kit");
  const brand = (await repo.getBrandByDomain("loopycases.com"))!;
  const heroIds = (brand.source as unknown as { hero_product_ids: string[] }).hero_product_ids;
  await confirmBrandKit(campaign.id, brand.id, { name: "Loopy Cases", colors: ["#8FE8B3", "#272D45"], font: "Exo 2", voice: "playful, bold", audience: "phone people", product_ids: heroIds.slice(0, n), goal: "Holiday gifting", tone_words: [] });
  return { campaign: (await repo.getCampaign(campaign.id))!, brand: (await repo.getBrand(brand.id))! };
}

export const ctxFor = (campaignId: string) => ({ campaignId, ...captureProgress() });
