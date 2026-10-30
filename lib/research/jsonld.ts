import type { ProductInput } from "@/lib/db/repo";
import { decodeEntities, resolveUrl, stripHtml } from "./html";

type LdProduct = { "@type"?: string | string[]; name?: string; description?: string; image?: string | string[] | { url: string }[]; sku?: string; offers?: { price?: string | number; priceCurrency?: string } | { price?: string | number; priceCurrency?: string }[] };

function findProducts(node: unknown, out: LdProduct[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => findProducts(n, out));
  const t = (node as LdProduct)["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) out.push(node as LdProduct);
  for (const v of Object.values(node)) if (typeof v === "object") findProducts(v, out);
}

/** schema.org Product blocks in a page → product rows. */
export function productsFromJsonLd(html: string, pageUrl: string): ProductInput[] {
  const found: LdProduct[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      findProducts(JSON.parse(m[1]), found);
    } catch {
      /* malformed block */
    }
  }
  return found
    .filter((p) => p.name)
    .map((p, i) => {
      const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
      const imgs = (Array.isArray(p.image) ? p.image : p.image ? [p.image] : []).map((x) => (typeof x === "string" ? x : x.url));
      return {
        source_id: p.sku ?? new URL(pageUrl).pathname + (i ? `#${i}` : ""),
        handle: new URL(pageUrl).pathname.split("/").filter(Boolean).pop() ?? null,
        title: decodeEntities(p.name!).trim(),
        description: stripHtml(p.description) || null,
        price: offer?.price != null ? String(offer.price) : null,
        currency: offer?.priceCurrency ?? null,
        url: pageUrl,
        tags: [],
        images: imgs.map((src, position) => ({ source_url: resolveUrl(src, pageUrl), position })),
      };
    });
}

/** Product-looking links on a homepage, same origin, deduped. */
export function productLinks(html: string, origin: string, max = 8): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    const u = resolveUrl(m[1], origin);
    if (!u.startsWith(origin)) continue;
    if (/\/(products?|shop|p|item|store)\/[\w-]+/i.test(new URL(u).pathname)) out.add(u.split("?")[0]);
    if (out.size >= max) break;
  }
  return [...out];
}
