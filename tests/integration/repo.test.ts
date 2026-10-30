import { describe, expect, it } from "vitest";
import * as repo from "@/lib/db/repo";
import { TransitionError } from "@/lib/db/status";
import { useFreshDb } from "../support/db";

describe("repository", () => {
  useFreshDb();

  it("brand → products → campaign → ad → variant round trip with enforced transitions", async () => {
    const brand = await repo.startBrandResearch("https://www.loopycases.com", "loopycases.com");
    expect(brand.status).toBe("researching");
    await repo.updateBrand(brand.id, { colors: ["#FF4FA3", "#111111"], source: { colors: "scraped" }, tone_words: ["playful"] });
    const b2 = await repo.setBrandStatus(brand.id, "draft");
    expect(b2.colors).toEqual(["#FF4FA3", "#111111"]);
    expect(b2.tone_words).toEqual(["playful"]);
    await expect(repo.setBrandStatus(brand.id, "researching").then(() => repo.setBrandStatus(brand.id, "confirmed"))).rejects.toThrow(TransitionError);

    const [p] = await repo.upsertProducts(brand.id, [
      { source_id: "1", handle: "case", title: "Case", description: "d", price: "29.00", currency: "USD", url: null, tags: ["a", "b"], images: [{ source_url: "https://cdn/x.jpg", position: 0 }] },
    ]);
    expect(p.tags).toEqual(["a", "b"]);
    // Upsert again: same row, no duplicates.
    const again = await repo.upsertProducts(brand.id, [{ ...p, images: [{ source_url: "https://cdn/x.jpg", position: 0 }] }]);
    expect(again[0].id).toBe(p.id);
    expect((await repo.listProducts(brand.id)).length).toBe(1);

    const c = await repo.createCampaign("https://www.loopycases.com", "Loopy");
    await repo.updateCampaign(c.id, { brand_id: brand.id, product_ids: [p.id] });
    expect((await repo.getCampaign(c.id))!.product_ids).toEqual([p.id]);
    expect(await repo.mergeConstraints(c.id, ["no busy backgrounds"])).toEqual(["no busy backgrounds"]);
    expect(await repo.mergeConstraints(c.id, ["No busy backgrounds", "serif"])).toEqual(["no busy backgrounds", "serif"]);

    const [ad] = await repo.insertAds(c.id, [
      { product_id: p.id, product_image_id: p.images[0].id, angle: "gift", headline: "H", cta: "Shop", layout: "split", scene_prompt: "s" },
    ]);
    const v = await repo.insertVariant({ ad_id: ad.id, layout: "split", copy: { headline: "H", cta: "Shop" } });
    await repo.updateVariant(v.id, {}, "generating_scene");
    await repo.updateVariant(v.id, { scene_path: "ad-scenes/x.png" }, "composing");
    const ready = await repo.updateVariant(v.id, { final_path: "ad-finals/x.png", qa: { issues: [] }, qa_status: "pass" }, "ready");
    expect(ready.copy).toEqual({ headline: "H", cta: "Shop" });
    await expect(repo.updateVariant(v.id, {}, "queued")).rejects.toThrow(TransitionError);
    await repo.setCurrentVariant(ad.id, v.id);
    expect((await repo.setAdStatus(ad.id, "approved")).status).toBe("approved");
    expect(await repo.adCounts(c.id)).toEqual({ total: 1, draft: 0, approved: 1, rejected: 0 });

    await repo.saveMessages(c.id, [{ id: "m1", role: "user" } as never, { id: "m2", role: "assistant" } as never]);
    await repo.saveMessages(c.id, [{ id: "m1", role: "user" } as never, { id: "m2", role: "assistant", x: 1 } as never, { id: "m3" } as never]);
    expect((await repo.loadMessages<{ id: string }>(c.id)).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});
