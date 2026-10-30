import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { detectStore, fetchShopifyProducts, MAX_PAGES, parseShopifyProducts } from "@/lib/adapters/shopify";
import { normalizeImageUrl } from "@/lib/research/shopify-url";
import * as http from "@/lib/adapters/http";

const loopy = JSON.parse(readFileSync("tests/fixtures/loopycases/products-page-1.json", "utf8"));

describe("Shopify parser", () => {
  it("maps fixture products.json to products + images", () => {
    const products = parseShopifyProducts(loopy, "https://www.loopycases.com", "USD");
    expect(products.length).toBe(loopy.products.length);
    const p = products.find((x) => x.handle === "cranberry-stripes")!;
    expect(p).toMatchObject({ title: "Cranberry Stripes", price: "42.99", currency: "USD", url: "https://www.loopycases.com/products/cranberry-stripes" });
    expect(p.tags[0]).toBe("cases");
    expect(p.images[0]).toMatchObject({ source_url: "https://cdn.shopify.com/s/files/1/0199/7596/files/cranberry5.jpg", width: 720, height: 960, position: 0 });
  });
  it("strips HTML from descriptions", () => {
    const [p] = parseShopifyProducts({ products: [{ id: 1, title: "X", body_html: '<p><span style="color:red"><em>A timeless&nbsp;stripe</em></span></p><ul><li>One &amp; two</li></ul><script>x()</script>' }] }, "https://s.com");
    expect(p.description).toBe("A timeless stripe\nOne & two");
  });
  it("handles products with 0 images and missing prices", () => {
    const [p] = parseShopifyProducts({ products: [{ id: 2, title: "Bare", images: [], variants: [{ price: null }] }, ] }, "https://s.com", "USD");
    expect(p.images).toEqual([]);
    expect(p.price).toBeNull();
    expect(p.currency).toBeNull();
  });
  it("drops GIF images and renumbers positions", () => {
    const [p] = parseShopifyProducts({ products: [{ id: 3, title: "G", images: [{ src: "//cdn.shopify.com/a.gif" }, { src: "//cdn.shopify.com/b.jpg" }] }] }, "https://s.com");
    expect(p.images).toEqual([{ source_url: "https://cdn.shopify.com/b.jpg", width: null, height: null, position: 0 }]);
  });
});

describe("image URL normalization", () => {
  it.each([
    ["//cdn.shopify.com/s/files/1/x/files/a.jpg?v=123", "https://cdn.shopify.com/s/files/1/x/files/a.jpg"],
    ["http://cdn.shopify.com/a_200x200.png", "https://cdn.shopify.com/a.png"],
    ["https://cdn.shopify.com/a_1024x.jpg?v=1&width=300", "https://cdn.shopify.com/a.jpg"],
    ["https://cdn.shopify.com/a_x600@2x.webp", "https://cdn.shopify.com/a.webp"],
    ["https://cdn.shopify.com/a_grande.jpg", "https://cdn.shopify.com/a.jpg"],
    ["https://cdn.shopify.com/case_2024.jpg", "https://cdn.shopify.com/case_2024.jpg"],
  ])("%s → %s", (input, out) => expect(normalizeImageUrl(input)).toBe(out));
});

describe("store detection", () => {
  it("JSON with products → shopify; HTML / 404 / other JSON → not", () => {
    expect(detectStore(200, "application/json; charset=utf-8", '{"products":[]}')).toBe("shopify");
    expect(detectStore(200, "text/html", "<html></html>")).toBe("not_shopify");
    expect(detectStore(404, "application/json", '{"products":[]}')).toBe("not_shopify");
    expect(detectStore(200, "application/json", '{"errors":"nope"}')).toBe("not_shopify");
    expect(detectStore(200, "application/json", "not json")).toBe("not_shopify");
  });
});

describe("pagination", () => {
  const page = (n: number) => ({ products: Array.from({ length: n }, (_, i) => ({ id: `${n}-${i}-${Math.random()}`, title: "P" })) });
  const respond = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  it("stops on an empty page", async () => {
    const spy = vi.spyOn(http, "httpGet").mockResolvedValueOnce(respond(page(250))).mockResolvedValueOnce(respond(page(0)));
    const r = await fetchShopifyProducts("https://s.com");
    expect(r).toMatchObject({ kind: "shopify", pages: 2 });
    expect(r.kind === "shopify" && r.products.length).toBe(250);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it("stops at the 3-page cap", async () => {
    const spy = vi.spyOn(http, "httpGet").mockImplementation(async () => respond(page(250)));
    const r = await fetchShopifyProducts("https://s.com");
    expect(spy).toHaveBeenCalledTimes(MAX_PAGES);
    expect(r.kind === "shopify" && r.products.length).toBe(750);
    spy.mockRestore();
  });
  it("HTML on page 1 means not Shopify", async () => {
    const spy = vi.spyOn(http, "httpGet").mockResolvedValue(new Response("<html/>", { headers: { "content-type": "text/html" } }));
    expect(await fetchShopifyProducts("https://s.com")).toEqual({ kind: "not_shopify" });
    spy.mockRestore();
  });
});
