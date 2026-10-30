import { env } from "@/lib/env";
import type { ProductInput } from "@/lib/db/repo";
import { fixtureJson } from "./fixture-http";
import { normalizeHex, type BrandSignals } from "@/lib/research/html-brand";

/** Firecrawl v2 /scrape response (only the parts we read). */
type FirecrawlScrape = {
  success: boolean;
  data?: {
    markdown?: string;
    links?: string[];
    branding?: { brandName?: string; logo?: string | null; colors?: Record<string, string | undefined>; fonts?: { family: string }[]; typography?: { fontFamilies?: Record<string, string | undefined> } };
    metadata?: { title?: string; description?: string };
    product?: FirecrawlProduct;
  };
  /** fixtures only: pre-baked product scrapes for the non-Shopify path */
  products?: { url: string; product: FirecrawlProduct }[];
};
type FirecrawlProduct = { name?: string; description?: string; price?: { amount?: number; currency?: string }; images?: { url: string }[] };

export class BrandExtractError extends Error {}

export interface BrandExtractor {
  /** Logo, colors, fonts, tagline from the homepage. Throws BrandExtractError on failure. */
  branding(origin: string): Promise<BrandSignals>;
  /** Non-Shopify product discovery: homepage + top product links. */
  products(origin: string): Promise<ProductInput[]>;
}

export function brandExtractor(): BrandExtractor {
  return env().AI_MODE === "mock" ? mockExtractor() : liveExtractor();
}

function toSignals(r: FirecrawlScrape): BrandSignals {
  const b = r.data?.branding;
  if (!r.success || !b) throw new BrandExtractError("Firecrawl returned no branding");
  const colors = ["primary", "secondary", "accent"].map((k) => normalizeHex(b.colors?.[k] ?? "")).filter((c): c is string => !!c);
  const fonts = [b.typography?.fontFamilies?.heading, b.typography?.fontFamilies?.primary, ...(b.fonts ?? []).map((f) => f.family)].filter((f, i, a): f is string => !!f && a.indexOf(f) === i);
  const title = r.data?.metadata?.title ?? "";
  return {
    name: b.brandName ?? null,
    logoUrl: b.logo ?? null,
    colors,
    fonts: fonts.slice(0, 3),
    tagline: title.split(/[|–—]/).slice(1).join(" ").trim() || null,
    description: r.data?.metadata?.description ?? null,
    text: (r.data?.markdown ?? "").slice(0, 4000),
  };
}

function toProducts(items: { url: string; product: FirecrawlProduct }[]): ProductInput[] {
  return items
    .filter((i) => i.product?.name)
    .map((i) => ({
      source_id: new URL(i.url).pathname,
      handle: new URL(i.url).pathname.split("/").filter(Boolean).pop() ?? null,
      title: i.product.name!,
      description: i.product.description ?? null,
      price: i.product.price?.amount != null ? String(i.product.price.amount) : null,
      currency: i.product.price?.currency ?? null,
      url: i.url,
      tags: [],
      images: (i.product.images ?? []).map((img, position) => ({ source_url: img.url, position })),
    }));
}

function mockExtractor(): BrandExtractor {
  const load = (origin: string) => {
    if (process.env.MOCK_FIRECRAWL_FAIL === "1") throw new BrandExtractError("Firecrawl mock failure (MOCK_FIRECRAWL_FAIL=1)");
    const fx = fixtureJson<FirecrawlScrape>(new URL(origin).hostname, "firecrawl.json");
    if (!fx) throw new BrandExtractError(`no Firecrawl fixture for ${origin}`);
    return fx;
  };
  return {
    async branding(origin) {
      return toSignals(load(origin));
    },
    async products(origin) {
      return toProducts(load(origin).products ?? []);
    },
  };
}

function liveExtractor(): BrandExtractor {
  const key = env().FIRECRAWL_API_KEY;
  const scrape = async (url: string, formats: unknown[]): Promise<FirecrawlScrape> => {
    if (!key) throw new BrandExtractError("FIRECRAWL_API_KEY not configured");
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ url, formats, onlyMainContent: false }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new BrandExtractError(`Firecrawl ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as FirecrawlScrape;
  };
  return {
    async branding(origin) {
      return toSignals(await scrape(origin, ["branding", "markdown"]));
    },
    async products(origin) {
      const home = await scrape(origin, ["links"]);
      const links = (home.data?.links ?? []).filter((l) => l.startsWith(origin) && /\/(products?|shop|p|item)\/[\w-]+/i.test(new URL(l).pathname)).slice(0, 5);
      const pages = await Promise.all(links.map(async (url) => ({ url, product: (await scrape(url, ["product"]).catch(() => null))?.data?.product ?? {} })));
      return toProducts(pages);
    },
  };
}
