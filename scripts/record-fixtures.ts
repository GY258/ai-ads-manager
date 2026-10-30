// pnpm fixtures:record https://www.loopycases.com [name]
// Saves products.json pages, a stripped homepage, product images and (if FIRECRAWL_API_KEY) the Firecrawl branding response.
import { config } from "dotenv";
config({ path: ".env.local" });
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeImageUrl } from "../lib/research/shopify-url";

const KEEP_PRODUCTS = 40;
const IMAGE_PRODUCTS = 12;
const UA = { "user-agent": "Mozilla/5.0 (Macintosh) ai-ads-manager fixture recorder" };

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("usage: fixtures:record <url> [name]");
  const origin = new URL(input.startsWith("http") ? input : `https://${input}`).origin;
  const domain = new URL(origin).hostname.replace(/^www\./, "");
  const name = process.argv[3] ?? domain.split(".")[0];
  const dir = path.join("tests/fixtures", name);
  await mkdir(path.join(dir, "images"), { recursive: true });

  const products: Record<string, unknown>[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`${origin}/products.json?limit=250&page=${page}`, { headers: UA });
    const body = (await res.json()) as { products: Record<string, unknown>[] };
    products.push(...body.products);
    if (!body.products.length) break;
  }
  // Keep a spread of product types, trimmed so the fixture stays small.
  const byType = new Map<string, Record<string, unknown>[]>();
  for (const p of products) byType.set(String(p.product_type), [...(byType.get(String(p.product_type)) ?? []), p]);
  const kept: Record<string, unknown>[] = [];
  for (const list of byType.values()) kept.push(...list.slice(0, 2));
  for (const p of products) if (kept.length < KEEP_PRODUCTS && !kept.includes(p)) kept.push(p);
  for (const p of kept) {
    p.body_html = String(p.body_html ?? "").slice(0, 3000);
    p.variants = ((p.variants as unknown[]) ?? []).slice(0, 3);
    p.images = ((p.images as unknown[]) ?? []).slice(0, 4);
  }
  await writeFile(path.join(dir, "products-page-1.json"), JSON.stringify({ products: kept }, null, 1));
  await writeFile(path.join(dir, "products-page-2.json"), JSON.stringify({ products: [] }));

  const html = await (await fetch(`${origin}/`, { headers: UA })).text();
  const stripped = html.replace(/<script\b(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "").replace(/\sdata-[\w-]+="[^"]{2000,}"/g, "").replace(/\n\s*\n+/g, "\n");
  await writeFile(path.join(dir, "homepage.html"), stripped);

  const images: Record<string, string> = {};
  // Images for the first products plus the core product type (what synthesis picks as heroes).
  const core = [...byType.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const withImages = [...new Set([...kept.slice(0, IMAGE_PRODUCTS), ...kept.filter((p) => core.includes(p)).slice(0, 6)])];
  for (const p of withImages) {
    for (const img of ((p.images as { src: string }[]) ?? []).slice(0, 2)) {
      const canon = normalizeImageUrl(img.src);
      if (canon.endsWith(".gif")) continue;
      const file = `${String(p.handle)}-${Object.keys(images).length}${path.extname(canon) || ".jpg"}`;
      const res = await fetch(`${canon}?width=720`, { headers: UA });
      await writeFile(path.join(dir, "images", file), Buffer.from(await res.arrayBuffer()));
      images[canon] = file;
    }
  }
  const og = html.match(/property="og:image:secure_url" content="([^"]+)"/)?.[1];
  if (og) {
    const canon = normalizeImageUrl(og);
    const res = await fetch(`${canon}?width=600`, { headers: UA });
    await writeFile(path.join(dir, "images", `logo${path.extname(canon) || ".png"}`), Buffer.from(await res.arrayBuffer()));
    images[canon] = `logo${path.extname(canon) || ".png"}`;
  }
  await writeFile(path.join(dir, "images.json"), JSON.stringify(images, null, 1));

  if (process.env.FIRECRAWL_API_KEY) {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ url: origin, formats: ["branding", "markdown"] }),
    });
    await writeFile(path.join(dir, "firecrawl.json"), JSON.stringify(await res.json(), null, 1));
  } else {
    console.warn("FIRECRAWL_API_KEY not set: firecrawl.json not recorded (write it by hand, see tests/fixtures/README.md)");
  }
  console.log(`recorded ${kept.length}/${products.length} products, ${Object.keys(images).length} images → ${dir} (domain ${domain})`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
