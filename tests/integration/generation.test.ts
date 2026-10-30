import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import * as repo from "@/lib/db/repo";
import { planConcepts, generateAds } from "@/lib/agent/tools/generation";
import { imageCalls } from "@/lib/adapters/image-gen";
import { mockCalls } from "@/lib/adapters/llm";
import { GET as localStorageGet } from "@/app/api/local-storage/[...path]/route";
import { download } from "@/lib/storage";
import { useFreshDb } from "../support/db";
import { useMsw } from "../support/msw";
import { confirmedCampaign, ctxFor } from "../support/factories";

async function fetchLocal(publicUrl: string) {
  const path = publicUrl.split("/api/local-storage/")[1].split("/");
  return localStorageGet(new Request("http://t"), { params: Promise.resolve({ path }) });
}

describe("planConcepts + generateAds", () => {
  const ref = useFreshDb();
  useMsw();
  beforeEach(() => {
    imageCalls.length = 0;
  });
  afterEach(() => {
    delete process.env.MOCK_IMAGE_FAIL;
  });

  it("planConcepts inserts the requested number of ads, all referencing existing product_image_ids, with ≥3 distinct angles", async () => {
    const { campaign } = await confirmedCampaign();
    const r = await planConcepts({ campaignId: campaign.id, count: 6 }, ctxFor(campaign.id));
    expect(r.ok).toBe(true);
    const ads = await repo.listAds(campaign.id);
    expect(ads).toHaveLength(6);
    expect(new Set(ads.map((a) => a.angle)).size).toBeGreaterThanOrEqual(3);
    for (const a of ads) {
      const img = await repo.getProductImage(a.product_image_id);
      expect(img?.product_id).toBe(a.product_id);
      expect(campaign.product_ids).toContain(a.product_id);
      expect(img?.storage_path).toBeTruthy();
      expect(a.scene_prompt).toMatch(/empty/i);
    }
    expect(new Set(ads.map((a) => a.product_id)).size).toBe(2); // spread across selected products
  });

  it("refuses to plan before the brand kit is confirmed", async () => {
    const c = await repo.createCampaign("https://www.loopycases.com", "x");
    expect(await planConcepts({ campaignId: c.id, count: 3 }, ctxFor(c.id))).toMatchObject({ ok: false, fallback: "confirm_brand_kit_first" });
  });

  it("generateAds for 3 ads: each ends ready, scene + final in Storage, public URL is a PNG, no provider URL stored", async () => {
    const { campaign } = await confirmedCampaign();
    const plan = await planConcepts({ campaignId: campaign.id, count: 3 }, ctxFor(campaign.id));
    const ctx = ctxFor(campaign.id);
    const r = await generateAds({ campaignId: campaign.id }, ctx);
    expect(r).toMatchObject({ ok: true, summary: { ready: 3, fallback: 0, failed: 0 } });
    expect(imageCalls).toHaveLength(3);
    expect(ctx.messages).toContain("Rendered ad 3/3");
    for (const a of await repo.listAds(campaign.id)) {
      const v = (await repo.getVariant(a.current_variant_id!))!;
      expect(v.status).toBe("ready");
      expect(v.scene_path).toBe(`ad-scenes/${a.id}/${v.id}.png`);
      expect(v.final_path).toBe(`ad-finals/${a.id}/${v.id}.png`);
      expect((await sharp(Buffer.from(await download(v.scene_path!))).metadata()).height).toBe(1920);
      const final = r.ok ? r.ads.find((x) => x.id === a.id)!.final_url! : "";
      const res = await fetchLocal(final);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    }
    const rows = await ref.db.query<{ n: number }>(`select count(*)::int as n from ad_variants where scene_path like 'http%' or final_path like 'http%' or scene_path like '%fal.media%'`);
    expect(rows[0].n).toBe(0);
    void plan;
  });

  it("MOCK_IMAGE_FAIL=1: one retry, then the variant is ready with model = 'fallback'", async () => {
    const { campaign } = await confirmedCampaign(1);
    await planConcepts({ campaignId: campaign.id, count: 1 }, ctxFor(campaign.id));
    process.env.MOCK_IMAGE_FAIL = "1";
    const r = await generateAds({ campaignId: campaign.id }, ctxFor(campaign.id));
    expect(imageCalls).toHaveLength(2);
    expect(r).toMatchObject({ ok: true, summary: { ready: 1, fallback: 1 } });
    const [ad] = await repo.listAds(campaign.id);
    const v = (await repo.getVariant(ad.current_variant_id!))!;
    expect(v).toMatchObject({ status: "ready", model: "fallback" });
    expect(v.final_path).toBeTruthy();
  });

  it("caps a single call at 6 ads and reports the remainder", async () => {
    const { campaign } = await confirmedCampaign();
    await planConcepts({ campaignId: campaign.id, count: 8 }, ctxFor(campaign.id));
    const r = await generateAds({ campaignId: campaign.id }, ctxFor(campaign.id));
    expect(r).toMatchObject({ ok: true, remaining: 2 });
    expect(imageCalls).toHaveLength(6);
  });

  it("feedback loop: a recorded constraint reaches planConcepts' prompt", async () => {
    const { campaign } = await confirmedCampaign();
    await repo.mergeConstraints(campaign.id, ["avoid busy backgrounds"]);
    mockCalls.length = 0;
    await planConcepts({ campaignId: campaign.id, count: 2 }, ctxFor(campaign.id));
    const call = mockCalls.find((c) => c.name === "plan-concepts")!;
    expect(call.prompt).toContain("Constraints:\n- avoid busy backgrounds");
    const ads = await repo.listAds(campaign.id);
    expect(ads.every((a) => /clean minimal/.test(a.scene_prompt))).toBe(true);
  });
});

describe("concept review (HITL)", () => {
  useFreshDb();
  useMsw();
  it("saves edits, deletes removed concepts, and rejects copy over the limits", async () => {
    const { finalizeConcepts } = await import("@/lib/campaign/concepts");
    const { campaign } = await confirmedCampaign();
    await planConcepts({ campaignId: campaign.id, count: 3 }, ctxFor(campaign.id));
    const ads = await repo.listAds(campaign.id);
    const decide = (overrides: Record<number, object>) => ads.map((a, i) => ({ id: a.id, keep: true, headline: a.headline, subhead: a.subhead, cta: a.cta, layout: a.layout, ...overrides[i] }));
    expect(await finalizeConcepts(campaign.id, decide({ 0: { headline: "one two three four five six seven" } }))).toMatchObject({ ok: false });
    const r = await finalizeConcepts(campaign.id, decide({ 0: { headline: "Grip it", layout: "split" }, 2: { keep: false } }));
    expect(r).toMatchObject({ ok: true, removed: 1, edited: 1 });
    const after = await repo.listAds(campaign.id);
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ headline: "Grip it", layout: "split" });
    expect(r.ok && r.approved.map((a) => a.number)).toEqual([1, 2]);
  });
});
