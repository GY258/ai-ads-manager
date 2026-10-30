import { describe, expect, it } from "vitest";
import * as repo from "@/lib/db/repo";
import { researchStore } from "@/lib/agent/tools/research-store";
import { download } from "@/lib/storage";
import { useFreshDb } from "../support/db";
import { useMsw } from "../support/msw";
import { captureProgress, newCampaign } from "../support/factories";

describe("researchStore", () => {
  const ref = useFreshDb();
  useMsw();

  it("Loopy fixture: 1 brand, N products, hero images in product-images/, status draft, correct source map", async () => {
    const c = await newCampaign();
    const { progress, messages } = captureProgress();
    const r = await researchStore({ url: "www.loopycases.com" }, { campaignId: c.id, progress });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.path).toBe("shopify");
    expect(r.counts.products).toBe(40);
    expect(r.status).toBe("draft");
    expect(r.name).toBe("Loopy Cases");
    expect(r.kit.colors).toEqual(["#8FE8B3", "#272D45", "#FFCF2A"]);
    expect(r.source).toMatchObject({ name: "scraped", colors: "scraped", fonts: "scraped", logo: "scraped", voice: "inferred", audience: "inferred", tone_words: "inferred" });
    expect(r.hero_products.length).toBeGreaterThanOrEqual(1);
    expect(r.counts.images_copied).toBe(r.hero_products.length * 2);
    expect(messages.some((m) => /Found 40 products/.test(m))).toBe(true);

    const brands = await ref.db.query<{ n: number }>("select count(*)::int as n from brands");
    expect(brands[0].n).toBe(1);
    const stored = await ref.db.query<{ storage_path: string }>("select storage_path from product_images where storage_path is not null");
    expect(stored.length).toBe(r.counts.images_copied);
    for (const s of stored) {
      expect(s.storage_path).toMatch(/^product-images\/[0-9a-f-]+\/[0-9a-f-]+\/\d\.jpg$/);
      expect((await download(s.storage_path)).byteLength).toBeGreaterThan(1000);
    }
    const brand = (await repo.getBrandByDomain("loopycases.com"))!;
    expect(brand.logo_path).toBe(`brand-assets/${brand.id}/logo.png`);
    expect((await repo.getCampaign(c.id))!.brand_id).toBe(brand.id);
  });

  it("twice on the same domain reuses the brand row (no duplicates), and a confirmed brand isn't re-scraped", async () => {
    const c = await newCampaign();
    const again = await researchStore({ url: "https://loopycases.com/collections/all" }, { campaignId: c.id, progress: () => {} });
    expect(again.ok).toBe(true);
    expect((await ref.db.query<{ n: number }>("select count(*)::int as n from brands"))[0].n).toBe(1);
    expect((await ref.db.query<{ n: number }>("select count(*)::int as n from products"))[0].n).toBe(40);

    const brand = (await repo.getBrandByDomain("loopycases.com"))!;
    await repo.setBrandStatus(brand.id, "confirmed");
    const reused = await researchStore({ url: "loopycases.com" }, { campaignId: c.id, progress: () => {} });
    expect(reused.ok && reused.reused).toBe(true);
  });

  it("non-Shopify fixture uses the Firecrawl path", async () => {
    const c = await newCampaign("https://fernwood.example");
    const r = await researchStore({ url: "https://fernwood.example" }, { campaignId: c.id, progress: () => {} });
    expect(r).toMatchObject({ ok: true, path: "firecrawl", name: "Fernwood Candle Co.", counts: { products: 2 } });
  });

  it("non-Shopify with Firecrawl down falls back to JSON-LD product pages", async () => {
    process.env.MOCK_FIRECRAWL_FAIL = "1";
    try {
      const c = await newCampaign("https://fernwood.example");
      const r = await researchStore({ url: "https://fernwood.example", force: true }, { campaignId: c.id, progress: () => {} });
      expect(r).toMatchObject({ ok: true, path: "jsonld", counts: { products: 2 } });
      expect(r.ok && r.source).toMatchObject({ colors: "fallback", logo: "fallback" });
    } finally {
      delete process.env.MOCK_FIRECRAWL_FAIL;
    }
  });

  it("empty-store fixture returns ok:false with the upload fallback", async () => {
    const c = await newCampaign("https://empty-shop.example");
    const r = await researchStore({ url: "empty-shop.example" }, { campaignId: c.id, progress: () => {} });
    expect(r).toMatchObject({ ok: false, fallback: "ask_for_product_urls_or_upload" });
    expect((await repo.getBrandByDomain("empty-shop.example"))!.status).toBe("failed");
  });

  it("Firecrawl mock failure still produces a draft kit from HTML meta tags, marked as fallback", async () => {
    process.env.MOCK_FIRECRAWL_FAIL = "1";
    try {
      const c = await newCampaign();
      const { progress, messages } = captureProgress();
      const r = await researchStore({ url: "www.loopycases.com", force: true }, { campaignId: c.id, progress });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.status).toBe("draft");
      expect(r.kit.colors[0]).toBe("#8FE8B3");
      expect(r.source).toMatchObject({ name: "fallback", colors: "fallback", fonts: "fallback", logo: "fallback" });
      expect(messages.some((m) => /fell back to page meta/.test(m))).toBe(true);
    } finally {
      delete process.env.MOCK_FIRECRAWL_FAIL;
    }
  });

  it("invalid and unreachable URLs ask for a valid URL", async () => {
    const c = await newCampaign();
    expect(await researchStore({ url: "not a url" }, { campaignId: c.id, progress: () => {} })).toMatchObject({ ok: false, fallback: "ask_for_valid_url" });
    expect(await researchStore({ url: "https://nowhere.invalid" }, { campaignId: c.id, progress: () => {} })).toMatchObject({ ok: false, fallback: "ask_for_valid_url" });
  });

  it("logs every run in tool_runs", async () => {
    const runs = await ref.db.query<{ tool: string; duration_ms: number }>("select tool, duration_ms from tool_runs");
    expect(runs.length).toBeGreaterThanOrEqual(7);
    expect(runs.every((r) => r.tool === "researchStore")).toBe(true);
  });
});
