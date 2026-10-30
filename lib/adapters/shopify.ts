import { httpGet } from "./http";
import { stripHtml } from "@/lib/research/html";
import { normalizeImageUrl } from "@/lib/research/shopify-url";
import type { ProductInput } from "@/lib/db/repo";

export const MAX_PAGES = 3;
const PAGE_SIZE = 250;

type ShopifyJsonProduct = {
  id: number | string;
  title: string;
  handle?: string;
  body_html?: string | null;
  product_type?: string;
  tags?: string[] | string;
  variants?: { price?: string | null }[];
  images?: { src: string; width?: number; height?: number; position?: number }[];
};

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

/** products.json → our product rows. Drops GIFs/videos; 0 images and missing prices are fine. */
export function parseShopifyProducts(json: { products?: ShopifyJsonProduct[] }, origin: string, currency: string | null = null): ProductInput[] {
  return (json.products ?? []).map((p) => {
    const price = p.variants?.find((v) => v.price != null)?.price ?? null;
    const tags = Array.isArray(p.tags) ? p.tags : typeof p.tags === "string" ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const images = (p.images ?? [])
      .map((img, i) => ({ source_url: normalizeImageUrl(img.src), width: img.width ?? null, height: img.height ?? null, position: img.position ?? i + 1 }))
      .filter((img) => IMAGE_EXT.test(img.source_url))
      .map((img, i) => ({ ...img, position: i }));
    return {
      source_id: String(p.id),
      handle: p.handle ?? null,
      title: p.title.trim(),
      description: stripHtml(p.body_html).slice(0, 2000) || null,
      price: price != null && price !== "" ? String(price) : null,
      currency: price != null ? currency : null,
      url: p.handle ? `${origin}/products/${p.handle}` : null,
      tags: p.product_type ? [p.product_type, ...tags] : tags,
      images,
    };
  });
}

export type StoreKind = "shopify" | "not_shopify";

/** JSON with a products array → Shopify; HTML, 404, or other JSON → not Shopify. */
export function detectStore(status: number, contentType: string | null, body: string): StoreKind {
  if (status !== 200 || !contentType?.includes("json")) return "not_shopify";
  try {
    const j = JSON.parse(body);
    return Array.isArray(j?.products) ? "shopify" : "not_shopify";
  } catch {
    return "not_shopify";
  }
}

export type ShopifyFetch =
  | { kind: "shopify"; products: ProductInput[]; pages: number }
  | { kind: "not_shopify" }
  | { kind: "unreachable"; error: string };

/** GET products.json page by page until an empty page or MAX_PAGES. */
export async function fetchShopifyProducts(origin: string, opts: { currency?: string | null; onPage?: (page: number, total: number) => void } = {}): Promise<ShopifyFetch> {
  const products: ProductInput[] = [];
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await httpGet(`${origin}/products.json?limit=${PAGE_SIZE}&page=${page}`);
    } catch (e) {
      if (page === 1) return { kind: "unreachable", error: (e as Error).message };
      break;
    }
    const body = await res.text();
    if (detectStore(res.status, res.headers.get("content-type"), body) !== "shopify") {
      if (page === 1) return { kind: "not_shopify" };
      break;
    }
    pages = page;
    const batch = parseShopifyProducts(JSON.parse(body), origin, opts.currency ?? null);
    if (!batch.length) break;
    products.push(...batch);
    opts.onPage?.(page, products.length);
  }
  return { kind: "shopify", products, pages };
}
