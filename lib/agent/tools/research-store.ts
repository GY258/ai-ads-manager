import { z } from "zod";
import * as repo from "@/lib/db/repo";
import type { FieldSource } from "@/lib/db/types";
import { fetchShopifyProducts } from "@/lib/adapters/shopify";
import { brandExtractor } from "@/lib/adapters/brand-extract";
import { httpGet } from "@/lib/adapters/http";
import { extractHtmlBrand, type BrandSignals } from "@/lib/research/html-brand";
import { productLinks, productsFromJsonLd } from "@/lib/research/jsonld";
import { copyLogo, copyProductImage } from "@/lib/research/copy-images";
import { sampleForSynthesis, synthesizeBrand } from "@/lib/agent/subagents/brand-synthesis";
import { publicUrl } from "@/lib/storage";
import { mapLimit } from "@/lib/util";
import { runTool, ToolError } from "./run";
import type { ToolContext } from "./types";

export const researchStoreInput = z.object({
  url: z.string().min(1).describe("Store URL or domain, e.g. www.loopycases.com"),
  force: z.boolean().optional().describe("Re-scrape even if the brand is already confirmed"),
});

export function normalizeStoreUrl(input: string): { origin: string; domain: string } | null {
  const raw = input.trim().replace(/^<|>$/g, "");
  if (!raw || /\s/.test(raw)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!u.hostname.includes(".") || !/^[a-z0-9.-]+$/i.test(u.hostname)) return null;
    return { origin: u.origin, domain: u.hostname.toLowerCase().replace(/^www\./, "") };
  } catch {
    return null;
  }
}

export type ResearchSummary = Awaited<ReturnType<typeof summarize>>;

async function summarize(brandId: string, extra: { reused?: boolean; productCount?: number; imagesCopied?: number; path?: string } = {}) {
  const brand = (await repo.getBrand(brandId))!;
  const products = await repo.listProducts(brandId);
  const heroIds = (brand.source as Record<string, unknown>).hero_product_ids as string[] | undefined;
  const hero = products.filter((p) => heroIds?.includes(p.id));
  return {
    brandId,
    reused: !!extra.reused,
    path: extra.path ?? "cached",
    name: brand.name,
    status: brand.status,
    counts: { products: extra.productCount ?? products.length, images_copied: extra.imagesCopied ?? 0 },
    kit: {
      logo_url: brand.logo_path ? publicUrl(brand.logo_path) : null,
      colors: brand.colors,
      fonts: brand.fonts,
      voice: brand.voice,
      audience: brand.audience,
      value_prop: brand.value_prop,
      tone_words: brand.tone_words,
    },
    hero_products: hero.map((p) => ({ id: p.id, title: p.title, image_url: p.images.find((i) => i.storage_path) ? publicUrl(p.images.find((i) => i.storage_path)!.storage_path!) : null })),
    source: Object.fromEntries(Object.entries(brand.source).filter(([k]) => k !== "hero_product_ids")) as Record<string, FieldSource>,
  };
}

export async function researchStore(input: z.infer<typeof researchStoreInput>, ctx: ToolContext) {
  return runTool("researchStore", ctx.campaignId, input, async () => {
    const norm = normalizeStoreUrl(input.url);
    if (!norm) throw new ToolError(`"${input.url}" isn't a valid store URL. Try something like www.loopycases.com`, "ask_for_valid_url");
    const { origin, domain } = norm;

    const existing = await repo.getBrandByDomain(domain);
    if (existing?.status === "confirmed" && !input.force) {
      await repo.updateCampaign(ctx.campaignId, { brand_id: existing.id });
      ctx.progress(`Using the confirmed brand kit for ${existing.name ?? domain}`);
      return { result: await summarize(existing.id, { reused: true }) };
    }

    const brand = await repo.startBrandResearch(origin, domain);
    await repo.updateCampaign(ctx.campaignId, { brand_id: brand.id });
    ctx.progress(`Reading ${domain}…`);
    let modelCalls = 0;
    try {
      const homeHtml = await httpGet(`${origin}/`).then((r) => (r.ok ? r.text() : null)).catch(() => null);
      const currency = homeHtml?.match(/Shopify\.currency\s*=\s*\{"active":"([A-Z]{3})"/)?.[1] ?? homeHtml?.match(/"currency":"([A-Z]{3})"/)?.[1] ?? null;

      // 1. Products (scrape)
      const shop = await fetchShopifyProducts(origin, { currency, onPage: (page, total) => ctx.progress(`Found ${total} products (page ${page})`) });
      if (shop.kind === "unreachable" && !homeHtml) throw new ToolError(`Couldn't reach ${origin} (${shop.error}). Check the URL, e.g. https://www.loopycases.com`, "ask_for_valid_url");
      let products = shop.kind === "shopify" ? shop.products : [];
      let productPath = shop.kind === "shopify" ? "shopify" : "firecrawl";
      if (shop.kind !== "shopify") {
        ctx.progress("Not a Shopify store — scanning product pages instead");
        products = await brandExtractor().products(origin).catch(() => []);
        if (!products.length && homeHtml) {
          productPath = "jsonld";
          const pages = await mapLimit(productLinks(homeHtml, origin), 3, (u) => httpGet(u).then((r) => (r.ok ? r.text() : "")).then((h) => productsFromJsonLd(h, u)).catch(() => []));
          products = pages.flat();
        }
      }
      if (!products.length) {
        throw new ToolError(`I couldn't find any products on ${domain}.`, "ask_for_product_urls_or_upload");
      }
      ctx.progress(`Found ${products.length} products`, { products: products.length });

      // 2. Brand signals (scrape), HTML meta as fallback per field
      const html = homeHtml ? extractHtmlBrand(homeHtml, origin) : null;
      let fc: BrandSignals | null = null;
      try {
        fc = await brandExtractor().branding(origin);
      } catch (e) {
        ctx.progress(`Brand extraction fell back to page meta tags (${(e as Error).message})`);
      }
      const source: Record<string, FieldSource> = {};
      const pick = <K extends keyof BrandSignals>(k: K, empty: (v: BrandSignals[K]) => boolean): BrandSignals[K] | null => {
        if (fc && !empty(fc[k])) return (source[k] = "scraped"), fc[k];
        if (html && !empty(html[k])) return (source[k] = "fallback"), html[k];
        return null;
      };
      const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
      const signals: BrandSignals = {
        name: pick("name", isEmpty) ?? domain,
        logoUrl: pick("logoUrl", isEmpty),
        colors: pick("colors", isEmpty) ?? ["#111111"],
        fonts: pick("fonts", isEmpty) ?? ["Inter"],
        tagline: pick("tagline", isEmpty),
        description: pick("description", isEmpty),
        text: fc?.text || html?.text || "",
      };
      if (!source.colors) source.colors = "fallback";
      if (!source.fonts) source.fonts = "fallback";

      // 3. Persist products, then synthesize (infer)
      const saved = await repo.upsertProducts(brand.id, products.slice(0, 750));
      ctx.progress("Drafting your brand kit…");
      const sample = sampleForSynthesis(saved);
      const synth = await synthesizeBrand(
        signals,
        (sample.length ? sample : saved.slice(0, 10)).map((p) => ({ id: p.id, title: p.title, description: p.description, type: p.tags[0] ?? null })),
      );
      modelCalls += synth.modelCalls;
      const s = synth.object;
      const nameScraped = source.name === "scraped" || source.name === "fallback";
      if (!nameScraped) source.name = "inferred";
      Object.assign(source, { voice: "inferred", value_prop: "inferred", audience: "inferred", tone_words: "inferred", hero_products: "inferred" });

      // 4. Copy logo + first 2 images of each hero product into Storage
      let logoPath: string | null = null;
      if (signals.logoUrl) logoPath = await copyLogo(brand.id, signals.logoUrl).catch(() => null);
      if (!logoPath) source.logo = "fallback";
      else source.logo = source.logoUrl === "scraped" ? "scraped" : "fallback";
      delete source.logoUrl;
      const heroImages = saved.filter((p) => s.suggested_hero_product_ids.includes(p.id)).flatMap((p) => p.images.slice(0, 2));
      let copied = 0;
      await mapLimit(heroImages, 4, async (img) => {
        await copyProductImage(brand.id, img).then(() => copied++).catch((e) => console.warn("image copy failed", e.message));
      });
      ctx.progress(`Copied ${copied} product photos`);

      await repo.updateBrand(brand.id, {
        name: nameScraped ? signals.name : s.name,
        logo_path: logoPath,
        colors: signals.colors,
        fonts: signals.fonts,
        voice: s.voice,
        value_prop: s.value_prop,
        audience: s.audience,
        tone_words: s.tone_words,
        source: { ...source, hero_product_ids: s.suggested_hero_product_ids } as never,
      });
      await repo.setBrandStatus(brand.id, "draft");
      return { result: await summarize(brand.id, { productCount: saved.length, imagesCopied: copied, path: productPath }), modelCalls };
    } catch (e) {
      await repo.setBrandStatus(brand.id, "failed").catch(() => {});
      throw e;
    }
  });
}
