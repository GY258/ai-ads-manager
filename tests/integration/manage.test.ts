import { beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/db/repo";
import { generateAds, planConcepts } from "@/lib/agent/tools/generation";
import { editAdCopy, regenerateAd, setAdStatus, recordFeedback } from "@/lib/agent/tools/manage";
import * as actions from "@/app/actions/ads";
import { imageCalls } from "@/lib/adapters/image-gen";
import { mockCalls } from "@/lib/adapters/llm";
import { getCampaignView } from "@/lib/campaign/view";
import { buildStateSummary } from "@/lib/agent/system-prompt";
import { useFreshDb } from "../support/db";
import { useMsw } from "../support/msw";
import { confirmedCampaign, ctxFor } from "../support/factories";

async function readyCampaign(count = 2) {
  const { campaign } = await confirmedCampaign();
  await planConcepts({ campaignId: campaign.id, count }, ctxFor(campaign.id));
  await generateAds({ campaignId: campaign.id }, ctxFor(campaign.id));
  imageCalls.length = 0;
  mockCalls.length = 0;
  return campaign;
}

const comparable = (v: Record<string, unknown>) => {
  const { id: _i, ad_id: _a, parent_variant_id: _p, created_at: _c, updated_at: _u, final_path: _f, scene_path, ...rest } = v;
  return { ...rest, scene_is_new: !String(scene_path).includes(String(_p)) };
};

describe("manage ads", () => {
  useFreshDb();
  useMsw();
  beforeEach(() => {
    imageCalls.length = 0;
  });

  it("editAdCopy creates a new variant, reuses the scene, and makes zero image calls", async () => {
    const c = await readyCampaign(1);
    const [ad] = await repo.listAds(c.id);
    const before = (await repo.getVariant(ad.current_variant_id!))!;
    const r = await editAdCopy({ adId: "1", headline: "Hold on tight" }, ctxFor(c.id));
    expect(r).toMatchObject({ ok: true, adNumber: 1 });
    expect(imageCalls).toHaveLength(0);
    expect(mockCalls).toHaveLength(0);
    const after = (await repo.getAd(ad.id))!;
    const v = (await repo.getVariant(after.current_variant_id!))!;
    expect(v.id).not.toBe(before.id);
    expect(v.scene_path).toBe(before.scene_path);
    expect(v.copy.headline).toBe("Hold on tight");
    expect(after.headline).toBe("Hold on tight");
    expect(await repo.listVariants(ad.id)).toHaveLength(2);
  });

  it("copy limits: headline > 6 words or CTA > 3 words are rejected with a shorten fallback", async () => {
    const c = await readyCampaign(1);
    expect(await editAdCopy({ adId: "1", headline: "one two three four five six seven" }, ctxFor(c.id))).toMatchObject({ ok: false, fallback: "shorten_copy" });
    expect(await editAdCopy({ adId: "1", cta: "shop the big sale" }, ctxFor(c.id))).toMatchObject({ ok: false, fallback: "shorten_copy" });
    expect(await repo.listVariants((await repo.listAds(c.id))[0].id)).toHaveLength(1);
  });

  it("regenerateAd scope=scene: new variant with parent_variant_id and a prompt containing the feedback", async () => {
    const c = await readyCampaign(1);
    const [ad] = await repo.listAds(c.id);
    const r = await regenerateAd({ adId: "1", feedback: "darker background, no props", scope: "scene" }, ctxFor(c.id));
    expect(r.ok).toBe(true);
    expect(imageCalls).toHaveLength(1);
    const v = (await repo.getVariant((await repo.getAd(ad.id))!.current_variant_id!))!;
    expect(v.parent_variant_id).toBe(ad.current_variant_id);
    expect(v.prompt).toContain("Change from the previous version: darker background, no props");
    const fb = await repo.recentFeedback(c.id, 1);
    expect(fb[0]).toMatchObject({ ad_id: ad.id, applied: true, parsed: { scope: "scene" } });
  });

  it("regenerateAd scope=copy: one small LLM call, no image call, same scene", async () => {
    const c = await readyCampaign(1);
    const [ad] = await repo.listAds(c.id);
    const r = await regenerateAd({ adId: "1", feedback: 'headline: "Grip it like you mean it"', scope: "copy" }, ctxFor(c.id));
    expect(r.ok).toBe(true);
    expect(imageCalls).toHaveLength(0);
    expect(mockCalls.map((m) => m.name)).toEqual(["rewrite-copy"]);
    const v = (await repo.getVariant((await repo.getAd(ad.id))!.current_variant_id!))!;
    expect(v.copy.headline).toBe("Grip it like you mean it");
    expect(v.scene_path).toBe((await repo.getVariant(ad.current_variant_id!))!.scene_path);
  });

  it("regenerateAd and the canvas server action produce identical variant rows for the same input", async () => {
    const c = await readyCampaign(2);
    const [a1, a2] = await repo.listAds(c.id);
    // Make both ads identical concepts so the only difference is the entry point.
    await repo.updateAd(a2.id, { headline: a1.headline, subhead: a1.subhead, cta: a1.cta, layout: a1.layout, scene_prompt: a1.scene_prompt });
    await (await import("@/lib/db/client")).getDb().then((db) => db.query("update ads set product_image_id = $2, product_id = $3, angle = $4 where id = $1", [a2.id, a1.product_image_id, a1.product_id, a1.angle]));
    const viaTool = await regenerateAd({ adId: "1", feedback: "warmer light", scope: "both" }, ctxFor(c.id));
    const viaCanvas = await actions.regenerateWithFeedback(c.id, a2.id, "warmer light", "both");
    expect(viaTool.ok && viaCanvas.ok).toBe(true);
    const v1 = (await repo.getVariant((await repo.getAd(a1.id))!.current_variant_id!))!;
    const v2 = (await repo.getVariant((await repo.getAd(a2.id))!.current_variant_id!))!;
    expect(comparable(v2 as never)).toEqual(comparable(v1 as never));
  });

  it("approve/reject server actions update status and the canvas query reflects it", async () => {
    const c = await readyCampaign(2);
    const [a1, a2] = await repo.listAds(c.id);
    expect(await actions.approveAd(c.id, a1.id)).toMatchObject({ ok: true, status: "approved" });
    expect(await actions.rejectAd(c.id, a2.id)).toMatchObject({ ok: true, status: "rejected" });
    const view = (await getCampaignView(c.id))!;
    expect(view.ads.map((a) => a.status)).toEqual(["approved", "rejected"]);
    // Regenerating a rejected ad moves it back to draft.
    await regenerateAd({ adId: "2", feedback: "try a different scene", scope: "scene" }, ctxFor(c.id));
    expect((await repo.getAd(a2.id))!.status).toBe("draft");
    expect(await setAdStatus({ adId: "2", status: "approved" }, ctxFor(c.id))).toMatchObject({ ok: true, adNumber: 2 });
  });

  it("restore variant moves current_variant_id without creating rows or calling any adapter", async () => {
    const c = await readyCampaign(1);
    const [ad] = await repo.listAds(c.id);
    const original = ad.current_variant_id!;
    await editAdCopy({ adId: "1", headline: "Hold on tight" }, ctxFor(c.id));
    imageCalls.length = 0;
    mockCalls.length = 0;
    const rowsBefore = (await repo.listVariants(ad.id)).length;
    const r = await actions.restoreVariant(c.id, ad.id, original);
    expect(r.ok).toBe(true);
    expect((await repo.listVariants(ad.id)).length).toBe(rowsBefore);
    expect(imageCalls.length + mockCalls.length).toBe(0);
    const now = (await repo.getAd(ad.id))!;
    expect(now.current_variant_id).toBe(original);
    expect(now.headline).toBe(ad.headline);
  });

  it("canvas edits write an events row, and the next state summary mentions it", async () => {
    const c = await readyCampaign(3);
    const ads = await repo.listAds(c.id);
    await actions.editCopy(c.id, ads[2].id, { headline: "Hold on tight" });
    const events = await repo.recentEvents(c.id);
    expect(events[0]).toMatchObject({ type: "ad_copy_edited", payload: { adNumber: 3 } });
    expect(await buildStateSummary(c.id)).toContain("user edited ad #3 headline");
    // Agent-side edits don't create events (the agent already knows).
    await editAdCopy({ adId: "1", headline: "Grip it" }, ctxFor(c.id));
    expect((await repo.recentEvents(c.id)).length).toBe(events.length);
  });

  it("recordFeedback merges campaign constraints so the next planConcepts sees them", async () => {
    const c = await readyCampaign(1);
    const r = await recordFeedback({ campaignId: c.id, text: "make it more premium", constraints: ["dark premium palette", "minimal props"] }, ctxFor(c.id));
    expect(r).toMatchObject({ ok: true, constraints: ["dark premium palette", "minimal props"] });
    await planConcepts({ campaignId: c.id, count: 1 }, ctxFor(c.id));
    expect(mockCalls.find((m) => m.name === "plan-concepts")!.prompt).toContain("- dark premium palette\n- minimal props");
    const newest = (await repo.listAds(c.id)).at(-1)!;
    expect(newest.scene_prompt).toMatch(/dark premium studio/);
  });
});

describe("interrupted renders", () => {
  const ref = useFreshDb();
  useMsw();
  it("a variant stuck in flight for > 6 minutes is marked failed when the canvas loads, so Retry shows", async () => {
    const { campaign } = await confirmedCampaign(1);
    await planConcepts({ campaignId: campaign.id, count: 2 }, ctxFor(campaign.id));
    const [a1, a2] = await repo.listAds(campaign.id);
    const stuck = await repo.insertVariant({ ad_id: a1.id, layout: "split", copy: { headline: "x", cta: "y" } });
    await repo.updateVariant(stuck.id, {}, "generating_scene");
    const fresh = await repo.insertVariant({ ad_id: a2.id, layout: "split", copy: { headline: "x", cta: "y" } });
    await ref.db.query("alter table ad_variants disable trigger ad_variants_touch");
    await ref.db.query("update ad_variants set updated_at = now() - interval '10 minutes' where id = $1", [stuck.id]);
    await ref.db.query("alter table ad_variants enable trigger ad_variants_touch");
    const view = (await getCampaignView(campaign.id))!;
    expect((await repo.getVariant(stuck.id))!.status).toBe("failed");
    expect((await repo.getVariant(fresh.id))!.status).toBe("queued");
    expect(view.ads[0].current?.status).toBe("failed");
  });
});
