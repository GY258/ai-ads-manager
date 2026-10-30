import { readFileSync } from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { FONTS, closestFont, type FontFamily } from "./font-catalog";

const DIR = path.join(process.cwd(), "public", "fonts");
const cache = new Map<string, { data: Buffer; font: opentype.Font }>();

function load(file: string) {
  let hit = cache.get(file);
  if (!hit) {
    const data = readFileSync(path.join(DIR, file));
    hit = { data, font: opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) };
    cache.set(file, hit);
  }
  return hit;
}

export function fontFiles(family: FontFamily) {
  const f = FONTS.find((x) => x.family === family) ?? FONTS[0];
  return { regular: load(f.files[400]), bold: load(f.files[800]) };
}

/** Satori font list for a family (+ Inter as a fallback for missing glyphs). */
export function satoriFonts(family: FontFamily) {
  const f = fontFiles(family);
  const inter = fontFiles("Inter");
  return [
    { name: family, data: f.regular.data, weight: 400 as const, style: "normal" as const },
    { name: family, data: f.bold.data, weight: 800 as const, style: "normal" as const },
    ...(family === "Inter" ? [] : [{ name: "Inter", data: inter.regular.data, weight: 400 as const, style: "normal" as const }]),
  ];
}

export function measure(text: string, family: FontFamily, sizePx: number, bold = true): number {
  const { font } = bold ? fontFiles(family).bold : fontFiles(family).regular;
  return font.getAdvanceWidth(text, sizePx, { kerning: true });
}

export { closestFont };
