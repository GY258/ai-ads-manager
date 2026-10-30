// Generates the scene PNG fixtures used by compose tests and the mock image model.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { buildScene, paletteFromPrompt } from "../lib/compose/scene-builder";

const W = 1080, H = 1920, DIR = "tests/fixtures/scenes";

async function main() {
  await mkdir(DIR, { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 3, background: "#FFFFFF" } }).png().toFile(`${DIR}/white.png`);
  await sharp({ create: { width: W, height: H, channels: 3, background: "#0A0A0A" } }).png().toFile(`${DIR}/black.png`);
  // Busy mid-tone stripes: mean luminance near the white/dark crossover, high spread → needs a scrim.
  const stripes = Array.from({ length: 96 }, (_, i) => `<rect x="${i * 12}" y="0" width="6" height="${H}" fill="${i % 2 ? "#D8D8D8" : "#3A3A3A"}"/>`).join("");
  await sharp(Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#8A8A8A"/>${stripes}</svg>`)).png().toFile(`${DIR}/noisy.png`);
  const photo = "tests/fixtures/loopycases/images/cranberry-stripes-0.jpg";
  await sharp(await buildScene(await sharp(photo).toBuffer(), "top_headline", paletteFromPrompt("playful lifestyle scene, brand colors #8FE8B3 #272D45"))).toFile(`${DIR}/lifestyle-top.png`);
  // A deliberately wrong "scene" for QA checks: a different product entirely.
  await sharp(await buildScene(await sharp("tests/fixtures/loopycases/images/watch-bands-17.jpg").toBuffer(), "top_headline", paletteFromPrompt("clean"))).toFile(`${DIR}/wrong-product.png`);
  console.log("scene fixtures written to", DIR);
}
main();
