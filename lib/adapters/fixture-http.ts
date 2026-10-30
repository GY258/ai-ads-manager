import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizeImageUrl } from "@/lib/research/shopify-url";

const ROOT = path.join(process.cwd(), "tests", "fixtures");
let index: Record<string, string> | null = null;

function fixtureIndex(): Record<string, string> {
  index ??= JSON.parse(readFileSync(path.join(ROOT, "index.json"), "utf8"));
  return index!;
}

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".html": "text/html; charset=utf-8" };
const file = (p: string, status = 200) => new Response(readFileSync(p), { status, headers: { "content-type": TYPES[path.extname(p)] ?? "application/octet-stream" } });
const notFound = () => new Response("<html><body>Not found</body></html>", { status: 404, headers: { "content-type": "text/html" } });

function findImage(canon: string): string | null {
  for (const dir of new Set(Object.values(fixtureIndex()))) {
    const map = path.join(ROOT, dir, "images.json");
    if (!existsSync(map)) continue;
    const hit = (JSON.parse(readFileSync(map, "utf8")) as Record<string, string>)[canon];
    if (hit) return path.join(ROOT, dir, "images", hit);
  }
  return null;
}

/** Serves recorded fixtures for known store domains and image URLs; null means "not a fixture URL". */
export function fixtureResponse(rawUrl: string): Response | null {
  const url = new URL(rawUrl);
  const img = findImage(normalizeImageUrl(rawUrl));
  if (img) return file(img);
  const domain = url.hostname.replace(/^www\./, "");
  const dirName = fixtureIndex()[domain];
  if (!dirName) return null;
  const dir = path.join(ROOT, dirName);
  if (url.pathname === "/products.json") {
    const first = path.join(dir, "products-page-1.json");
    if (!existsSync(first)) return notFound();
    const page = path.join(dir, `products-page-${url.searchParams.get("page") ?? "1"}.json`);
    return existsSync(page) ? file(page) : new Response('{"products":[]}', { headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/" || url.pathname === "") return file(path.join(dir, "homepage.html"));
  const shop = url.pathname.match(/^\/shop\/([\w-]+)/);
  if (shop && existsSync(path.join(dir, `product-${shop[1]}.html`))) return file(path.join(dir, `product-${shop[1]}.html`));
  return notFound();
}

export function fixtureJson<T>(domain: string, name: string): T | null {
  const dirName = fixtureIndex()[domain.replace(/^www\./, "")];
  if (!dirName) return null;
  const p = path.join(ROOT, dirName, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}
