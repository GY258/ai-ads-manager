import { describe, expect, it } from "vitest";
import { readiness } from "@/lib/pipeline/readiness";

const layout = { headline_px: 112, contrast: 12, cta_contrast: 9, safe_margins: true };

describe("placement readiness", () => {
  it("big, high-contrast, QA-passed ad scores 100", () => {
    expect(readiness({ layout, scene: { product_match: "pass" } })).toMatchObject({ score: 100, grade: "ready" });
  });
  it("small low-contrast text and a failed product check pull the score down", () => {
    const r = readiness({ layout: { headline_px: 64, contrast: 4.6, cta_contrast: 2.5, safe_margins: true }, scene: { product_match: "fail" } })!;
    expect(r.grade).toBe("fix");
    expect(r.checks.find((c) => c.id === "text_size")!.detail).toBe("23px at phone width");
  });
  it("fallback ads are marked as the real product photo", () => {
    expect(readiness({ layout, fallback: true })!.checks.find((c) => c.id === "product")!.detail).toMatch(/fallback/);
  });
  it("no layout QA → no score", () => {
    expect(readiness({})).toBeNull();
  });
});
