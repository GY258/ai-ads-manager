"use server";

import * as ops from "@/lib/campaign/ad-ops";
import * as repo from "@/lib/db/repo";
import type { Layout } from "@/lib/db/types";
import { runTool } from "@/lib/agent/tools/run";
import { variantView } from "@/lib/campaign/view";

/** Canvas actions: same functions as the agent tools (lib/campaign/ad-ops), no LLM in the loop for review. */

export async function approveAd(campaignId: string, adId: string) {
  return runTool("canvas.setAdStatus", campaignId, { adId, status: "approved" }, async () => ({ result: await ops.setStatus(campaignId, adId, "approved", "canvas") }));
}
export async function rejectAd(campaignId: string, adId: string) {
  return runTool("canvas.setAdStatus", campaignId, { adId, status: "rejected" }, async () => ({ result: await ops.setStatus(campaignId, adId, "rejected", "canvas") }));
}
export async function resetAd(campaignId: string, adId: string) {
  return runTool("canvas.setAdStatus", campaignId, { adId, status: "draft" }, async () => ({ result: await ops.setStatus(campaignId, adId, "draft", "canvas") }));
}
export async function editCopy(campaignId: string, adId: string, edit: { headline?: string; subhead?: string | null; cta?: string; layout?: Layout }) {
  return runTool("canvas.editAdCopy", campaignId, { adId, ...edit }, async () => ({ result: await ops.editCopy(campaignId, adId, edit, "canvas") }));
}
export async function regenerateWithFeedback(campaignId: string, adId: string, feedback: string, scope: "scene" | "copy" | "both") {
  return runTool("canvas.regenerateAd", campaignId, { adId, feedback, scope }, () => ops.regenerate(campaignId, adId, feedback, scope, "canvas"));
}
export async function restoreVariant(campaignId: string, adId: string, variantId: string) {
  return runTool("canvas.restoreVariant", campaignId, { adId, variantId }, async () => ({ result: await ops.restoreVariant(campaignId, adId, variantId, "canvas") }));
}
export async function retryAd(campaignId: string, adId: string) {
  return runTool("canvas.retry", campaignId, { adId }, async () => ({ result: await ops.retry(campaignId, adId) }));
}
export async function listVariants(adId: string) {
  return (await repo.listVariants(adId)).map(variantView);
}
