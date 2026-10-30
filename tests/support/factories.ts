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
