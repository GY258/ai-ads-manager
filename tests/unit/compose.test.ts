import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeAd } from "@/lib/compose/compose";
import { pickTreatment, sampleZone, textContrast, zonesFor, TEXT_DARK, TEXT_LIGHT } from "@/lib/compose/contrast";
import { fitHeadline, HEADLINE_MAX_PX } from "@/lib/compose/fit";
import { buildHeroScene } from "@/lib/compose/scene-builder";

const scene = (n: string) => readFileSync(`tests/fixtures/scenes/${n}.png`);
const logo = readFileSync("tests/fixtures/loopycases/images/logo.png");
const kit = { colors: ["#8FE8B3", "#272D45"], font: "Exo 2" };
const copy = { headline: "Never drop your phone again", subhead: "The finger loop case loved by 70,000 reviewers", cta: "Shop now" };

describe("contrast picker", () => {
  const zone = zonesFor("top_headline").headline;
  it("white zone → dark text, no scrim", async () => {
    const t = pickTreatment(await sampleZone(scene("white"), zone), "top_headline", "#8FE8B3");
    expect(t).toEqual({ text: TEXT_DARK, scrim: null });
  });
  it("black zone → white text, no scrim", async () => {
    const t = pickTreatment(await sampleZone(scene("black"), zone), "top_headline", "#8FE8B3");
    expect(t).toEqual({ text: TEXT_LIGHT, scrim: null });
  });
  it("noisy zone → adds a scrim and reaches ≥ 4.5:1", async () => {
    const stats = await sampleZone(scene("noisy"), zone);
    const t = pickTreatment(stats, "top_headline", "#8FE8B3");
    expect(t.scrim).not.toBeNull();
    expect(textContrast(stats, t)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("text fitting", () => {
  it("short headline renders at max size", () => {
    const f = fitHeadline("Grip it", "Exo 2", 952, 400);
    expect(f).toMatchObject({ ok: true, sizePx: HEADLINE_MAX_PX, lines: ["Grip it"] });
  });
  it("a 6-word headline fits in ≤ 3 lines", () => {
    const f = fitHeadline("The comfiest grip you will own", "Exo 2", 952, 400);
    expect(f.ok).toBe(true);
    if (f.ok) expect(f.lines.length).toBeLessThanOrEqual(3);
  });
  it("an over-long headline returns too_long", () => {
    expect(fitHeadline("Supercalifragilistic expialidocious phone case grip technology extravaganza for everyone everywhere", "Exo 2", 952, 300)).toEqual({ ok: false, reason: "too_long" });
  });
});

describe("composeAd", () => {
  it.each(["top_headline", "bottom_card", "split"] as const)("returns exactly 1080×1920 for %s", async (layout) => {
    const r = await composeAd({ scene: scene("lifestyle-top"), copy, kit, layout, logo, allowLayoutSwitch: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = await sharp(r.png).metadata();
    expect([m.width, m.height, m.format]).toEqual([1080, 1920, "png"]);
    expect(r.qa.headline_px).toBeGreaterThanOrEqual(64);
    expect(r.qa.contrast).toBeGreaterThanOrEqual(4.5);
    expect(r.qa.safe_margins).toBe(true);
  });
  it("product hero fallback template is 1080×1920 too", async () => {
    const hero = await buildHeroScene(readFileSync("tests/fixtures/loopycases/images/cranberry-stripes-0.jpg"), "#8FE8B3", "bottom_card");
    const r = await composeAd({ scene: hero, copy, kit, layout: "bottom_card", logo });
    expect(r.ok && (await sharp(r.png).metadata()).height).toBe(1920);
  });
  it("scales any scene to cover 1080×1920", async () => {
    const square = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#fff" } }).png().toBuffer();
    const r = await composeAd({ scene: square, copy, kit, layout: "split" });
    expect(r.ok && (await sharp(r.png).metadata()).width).toBe(1080);
  });
  it("layout QA: low-contrast scene gets a scrim and reaches ≥ 4.5:1", async () => {
    const r = await composeAd({ scene: scene("noisy"), copy, kit, layout: "top_headline" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.qa.scrim).not.toBeNull();
      expect(r.qa.contrast).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("layout QA: an over-long headline returns copy_too_long after trying all layouts", async () => {
    const r = await composeAd({ scene: scene("white"), copy: { ...copy, headline: "Unbelievably comfortable fingerloop protective smartphone accessories engineered beautifully" }, kit, layout: "split" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("copy_too_long");
      expect(r.attempts.map((a) => a.split(":")[0])).toEqual(["split", "top_headline", "bottom_card"]);
    }
  });
});

describe("golden snapshots", () => {
  const DIR = "tests/fixtures/golden";
  const cases = [
    { name: "top_headline-white", scene: "white", layout: "top_headline" as const },
    { name: "bottom_card-noisy", scene: "noisy", layout: "bottom_card" as const },
    { name: "split-lifestyle", scene: "lifestyle-top", layout: "split" as const },
  ];
  it.each(cases)("$name matches golden within tolerance", async (c) => {
    const r = await composeAd({ scene: scene(c.scene), copy, kit, layout: c.layout, logo, allowLayoutSwitch: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const file = `${DIR}/${c.name}.png`;
    if (!existsSync(file) || process.env.UPDATE_GOLDENS === "1") {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, r.png);
      return;
    }
    const small = async (b: Buffer) => sharp(b).resize(270, 480).raw().toBuffer();
    const [a, b] = await Promise.all([small(r.png), small(readFileSync(file))]);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff / a.length).toBeLessThan(1.5); // mean abs difference per channel (0-255)
  });
});
