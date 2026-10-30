import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as repo from "@/lib/db/repo";
import { planConcepts } from "@/lib/agent/tools/generation";
import { renderVariant } from "@/lib/pipeline/render-variant";
import { imageCalls } from "@/lib/adapters/image-gen";
import { qaCalls, resetMockQa } from "@/lib/pipeline/scene-qa";
import { useFreshDb } from "../support/db";
import { useMsw } from "../support/msw";
import { confirmedCampaign, ctxFor } from "../support/factories";

async function oneAd() {
  const { campaign } = await confirmedCampaign(1);
  await planConcepts({ campaignId: campaign.id, count: 1 }, ctxFor(campaign.id));
  const [ad] = await repo.listAds(campaign.id);
  return { campaign, ad };
}

describe("renderVariant + scene QA", () => {
  useFreshDb();
  useMsw();
  beforeEach(() => {
    imageCalls.length = 0;
    resetMockQa();
    process.env.QA_MODE = "full";
  });
  afterEach(() => {
    delete process.env.QA_MODE;
    delete process.env.MOCK_QA_SCRIPT;
  });

  it("all stages: image adapter once, QA once, ready with qa_status = pass", async () => {
    const { ad } = await oneAd();
    const r = await renderVariant(ad.id, { mode: "full" });
    expect(r.ok).toBe(true);
    expect(imageCalls).toHaveLength(1);
    expect(qaCalls).toHaveLength(1);
    expect(r.ok && r.variant).toMatchObject({ status: "ready", qa_status: "pass" });
  });

  it('scripted QA "product fail, then pass": exactly one retry, corrective prompt has the issues, final pass', async () => {
    process.env.MOCK_QA_SCRIPT = "product_fail,pass";
    const { ad } = await oneAd();
    const r = await renderVariant(ad.id, { mode: "full" });
    expect(imageCalls).toHaveLength(2);
    expect(qaCalls).toHaveLength(2);
    expect(imageCalls[1].prompt).toContain("Fix these problems from the last attempt: case print differs from the reference");
    expect(r.ok && r.variant).toMatchObject({ status: "ready", qa_status: "pass" });
    expect(r.ok && r.variant.model).not.toBe("fallback");
  });

  it('scripted QA "product fail twice": hero fallback, the mismatched scene is never shown', async () => {
    process.env.MOCK_QA_SCRIPT = "product_fail,product_fail";
    const { ad } = await oneAd();
    const r = await renderVariant(ad.id, { mode: "full" });
    expect(imageCalls).toHaveLength(2);
    expect(r.ok && r.variant).toMatchObject({ status: "ready", model: "fallback", qa_status: "warn" });
    expect(r.ok && (r.variant.qa as { scene: { fallback_reason: string } }).scene.fallback_reason).toMatch(/did not match/);
  });

  it('scripted QA "zone not clean twice": kept with qa_status = warn and a scrim', async () => {
    process.env.MOCK_QA_SCRIPT = "zone_fail,zone_fail";
    const { ad } = await oneAd();
    const r = await renderVariant(ad.id, { mode: "full" });
    expect(imageCalls).toHaveLength(2);
    expect(r.ok && r.variant).toMatchObject({ status: "ready", qa_status: "warn" });
    expect(r.ok && r.variant.model).not.toBe("fallback");
    expect(r.ok && (r.variant.qa as { layout: { scrim: unknown } }).layout.scrim).not.toBeNull();
  });

  it("QA_MODE=layout skips the vision call and records scene QA as skipped", async () => {
    process.env.QA_MODE = "layout";
    const { ad } = await oneAd();
    const r = await renderVariant(ad.id, { mode: "full" });
    expect(qaCalls).toHaveLength(0);
    expect(r.ok && (r.variant.qa as { scene: unknown }).scene).toEqual({ skipped: true });
    expect(r.ok && r.variant.qa_status).toBe("pass");
  });

  it("compose mode: zero image/QA calls, same scene_path as the parent, new row", async () => {
    const { ad } = await oneAd();
    const first = await renderVariant(ad.id, { mode: "full" });
    imageCalls.length = 0;
    resetMockQa();
    const r = await renderVariant(ad.id, { mode: "compose", copy: { headline: "Grip it", cta: "Shop" } });
    expect(imageCalls).toHaveLength(0);
    expect(qaCalls).toHaveLength(0);
    expect(r.ok && first.ok && r.variant.scene_path).toBe(first.ok && first.variant.scene_path);
    expect(r.ok && r.variant.parent_variant_id).toBe(first.ok && first.variant.id);
    expect((await repo.listVariants(ad.id)).length).toBe(2);
  });

  it("copy too long: the variant is saved as failed with copy_too_long, the previous current stays", async () => {
    const { ad } = await oneAd();
    const first = await renderVariant(ad.id, { mode: "full" });
    const r = await renderVariant(ad.id, { mode: "compose", copy: { headline: "Extraordinarily comfortable fingerloop protective smartphone accessories engineered beautifully for everybody worldwide", cta: "Shop" } });
    expect(r).toMatchObject({ ok: false, reason: "copy_too_long" });
    expect(r.variant).toMatchObject({ status: "failed", error: "copy_too_long" });
    expect((await repo.getAd(ad.id))!.current_variant_id).toBe(first.ok && first.variant.id);
  });
});
