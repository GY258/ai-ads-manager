import * as repo from "@/lib/db/repo";
import type { Layout } from "@/lib/db/types";
import { copySchema } from "@/lib/agent/schemas";
import { rewriteCopy } from "@/lib/agent/subagents/rewrite-copy";
import { renderVariant, type RenderResult } from "@/lib/pipeline/render-variant";
import { ToolError } from "@/lib/agent/tools/run";
import type { Progress } from "@/lib/agent/tools/types";
import { publicUrl } from "@/lib/storage";

/**
 * Ad operations shared by the agent tools and the canvas server actions, so a click and a chat
 * message produce identical rows. `source` only decides whether an events row is written for the agent.
 */
export type Source = "agent" | "canvas";

async function resolve(campaignId: string, ref: string) {
  const hit = await repo.resolveAdRef(campaignId, ref);
  if (!hit) throw new ToolError(`There's no ad ${/^\d+$/.test(ref) ? `#${ref}` : ref} in this campaign.`, "none");
  return hit;
}

function rendered(r: RenderResult, extra: Record<string, unknown> = {}) {
  if (!r.ok) {
    if (r.reason === "copy_too_long") throw new ToolError(r.error, "shorten_copy", { adNumber: r.adNumber });
    throw new ToolError(`Rendering ad #${r.adNumber} failed: ${r.error}`, "retry", { adNumber: r.adNumber });
  }
  return { adId: r.variant.ad_id, adNumber: r.adNumber, variantId: r.variant.id, final_url: r.variant.final_path ? publicUrl(r.variant.final_path) : null, qa_status: r.qaStatus, fallback: r.fallback, ...extra };
}

export async function setStatus(campaignId: string, ref: string, status: "draft" | "approved" | "rejected", source: Source) {
  const { ad, number } = await resolve(campaignId, ref);
  await repo.setAdStatus(ad.id, status);
  if (source === "canvas") await repo.insertEvent(campaignId, "ad_status", { adId: ad.id, adNumber: number, status });
  return { adId: ad.id, adNumber: number, status };
}

export type CopyEdit = { headline?: string; subhead?: string | null; cta?: string; layout?: Layout };

/** Direct copy edit: validate limits, re-compose from the existing scene. Zero model calls. */
export async function editCopy(campaignId: string, ref: string, edit: CopyEdit, source: Source, progress?: Progress) {
  const { ad, number } = await resolve(campaignId, ref);
  const copy = { headline: edit.headline ?? ad.headline, subhead: edit.subhead !== undefined ? edit.subhead || null : ad.subhead, cta: edit.cta ?? ad.cta };
  const parsed = copySchema.safeParse(copy);
  if (!parsed.success) throw new ToolError(parsed.error.issues.map((i) => i.message).join("; "), "shorten_copy", { adNumber: number });
  if (!ad.current_variant_id) throw new ToolError(`Ad #${number} has no image yet — generate it first.`, "none");
  const r = await renderVariant(ad.id, { mode: "compose", copy: parsed.data, layout: edit.layout ?? ad.layout, progress });
  const fields = Object.fromEntries(Object.entries(edit).filter(([, v]) => v !== undefined));
  if (source === "canvas") await repo.insertEvent(campaignId, "ad_copy_edited", { adId: ad.id, adNumber: number, fields });
  return rendered(r);
}

/** Feedback on one ad: copy-only re-composes (small LLM call), scene/both makes a new image from the parent prompt + delta. */
export async function regenerate(campaignId: string, ref: string, feedback: string, scope: "scene" | "copy" | "both", source: Source, progress?: Progress) {
  const { ad, number } = await resolve(campaignId, ref);
  const campaign = (await repo.getCampaign(campaignId))!;
  const brand = campaign.brand_id ? await repo.getBrand(campaign.brand_id) : null;
  const fb = await repo.insertFeedback({ campaign_id: campaignId, ad_id: ad.id, variant_id: ad.current_variant_id, text: feedback, parsed: { scope, delta: feedback } });
  if (ad.status === "rejected") await repo.setAdStatus(ad.id, "draft");
  let modelCalls = 0;
  let copy;
  if (scope !== "scene") {
    const rw = await rewriteCopy(ad, feedback, brand?.voice ?? null);
    copy = rw.copy;
    modelCalls += rw.modelCalls;
  }
  const mode = scope === "copy" && ad.current_variant_id ? "compose" : "full";
  const r = await renderVariant(ad.id, { mode, copy, delta: scope === "copy" ? null : feedback, progress });
  modelCalls += r.modelCalls;
  if (r.ok) await repo.markFeedbackApplied(fb.id);
  if (source === "canvas") await repo.insertEvent(campaignId, "ad_regenerated", { adId: ad.id, adNumber: number, scope, feedback });
  return { result: rendered(r, { scope }), modelCalls };
}

export async function recordFeedback(campaignId: string, ref: string | null | undefined, text: string, constraints: string[]) {
  const ad = ref ? (await resolve(campaignId, ref)).ad : null;
  await repo.insertFeedback({ campaign_id: campaignId, ad_id: ad?.id ?? null, text, parsed: { constraints }, applied: !ad });
  const merged = ad ? (await repo.getCampaign(campaignId))!.constraints : await repo.mergeConstraints(campaignId, constraints);
  return { constraints: merged, scope: ad ? "ad" : "campaign" };
}

/** Undo = move the pointer back. No rows, no adapters. */
export async function restoreVariant(campaignId: string, adId: string, variantId: string, source: Source) {
  const v = await repo.getVariant(variantId);
  if (!v || v.ad_id !== adId || v.status !== "ready") throw new ToolError("That version can't be restored.", "none");
  const ad = await repo.setCurrentVariant(adId, variantId);
  await repo.updateAd(adId, { headline: v.copy.headline, subhead: v.copy.subhead ?? null, cta: v.copy.cta, layout: v.layout });
  const number = await repo.adNumber(ad);
  if (source === "canvas") await repo.insertEvent(campaignId, "variant_restored", { adId, adNumber: number, variantId });
  return { adId, adNumber: number, variantId };
}

/** Canvas retry for a failed or fallback ad: a fresh full render. */
export async function retry(campaignId: string, ref: string, progress?: Progress) {
  const { ad } = await resolve(campaignId, ref);
  return rendered(await renderVariant(ad.id, { mode: "full", progress }));
}
