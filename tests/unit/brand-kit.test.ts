import { describe, expect, it } from "vitest";
import { brandKitSchema, brandSynthesisSchema, copySchema } from "@/lib/agent/schemas";
import { synthesizeBrand } from "@/lib/agent/subagents/brand-synthesis";
import { extractHtmlBrand } from "@/lib/research/html-brand";
import { readFileSync } from "node:fs";

const kit = { name: "Loopy", colors: ["#8FE8B3", "#272D45"], font: "Exo", voice: "playful", audience: "teens", product_ids: ["8b0d5c0e-0000-4000-8000-000000000001"], goal: "holiday gifting" };

describe("brand kit schema", () => {
  it("accepts the mock synthesis output", async () => {
    const { object } = await synthesizeBrand({ name: "Loopy", logoUrl: null, colors: [], fonts: [], tagline: null, description: "Grip cases.", text: "" }, [
      { id: "a", title: "Case", description: null, type: "cases" },
    ]);
    expect(brandSynthesisSchema.parse(object)).toEqual(object);
    expect(object.suggested_hero_product_ids).toEqual(["a"]);
  });
  it("accepts a valid kit and rejects invalid hex colors", () => {
    expect(brandKitSchema.safeParse(kit).success).toBe(true);
    for (const bad of ["#FFF", "FF4FA3", "#GG0000", "red"]) expect(brandKitSchema.safeParse({ ...kit, colors: [bad] }).success).toBe(false);
  });
});

describe("copy limits", () => {
  it("rejects headline > 6 words and CTA > 3 words", () => {
    expect(copySchema.safeParse({ headline: "Grip it like you mean it", cta: "Shop now" }).success).toBe(true);
    expect(copySchema.safeParse({ headline: "one two three four five six seven", cta: "Shop" }).success).toBe(false);
    expect(copySchema.safeParse({ headline: "Hi", cta: "Shop the whole sale" }).success).toBe(false);
  });
});

describe("HTML brand fallback", () => {
  it("pulls name, logo, colors and fonts from the Loopy homepage meta + CSS", () => {
    const s = extractHtmlBrand(readFileSync("tests/fixtures/loopycases/homepage.html", "utf8"), "https://www.loopycases.com");
    expect(s.name).toBe("Loopy Cases");
    expect(s.logoUrl).toMatch(/shopify_logo_dark/);
    expect(s.colors[0]).toBe("#8FE8B3");
    expect(s.fonts).toContain("Roboto");
    expect(s.description).toMatch(/Trusted since 2012/);
  });
});

describe("HTML brand fallback — live-page regressions", () => {
  it("ignores colors inside <script> and survives entity-quoted font names", () => {
    const html = `<html><head><style>.x{color:#8FE8B3}.y{font-family: -apple-system, BlinkMacSystemFont, &#39;Segoe UI&#39;, Exo2, sans-serif}</style>
      <script>window.tw={green:"#166534",g2:"#15803D",g3:"#166534",g4:"#166534"}</script></head></html>`;
    const s = extractHtmlBrand(html, "https://s.com");
    expect(s.colors).toEqual(["#8FE8B3"]);
    expect(s.fonts).toEqual(["Exo2"]); // Segoe UI is a system font, filtered
  });
});
