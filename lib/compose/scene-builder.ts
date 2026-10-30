import sharp from "sharp";
import { H, W, hexToRgb, type Layout } from "./contrast";

export type ScenePalette = { from: string; to: string; accent: string; busy: boolean };

/** Where the product goes so the layout's text zone stays empty. */
function productBox(layout: Layout | "center") {
  switch (layout) {
    case "top_headline":
      return { top: 700, height: 1000 };
    case "bottom_card":
      return { top: 190, height: 1080 };
    case "split":
      return { top: 470, height: 1080 };
    default:
      return { top: 420, height: 1080 };
  }
}

async function roundedPhoto(photo: Buffer | Uint8Array, maxW: number, maxH: number, radius = 48, card?: string) {
  const resized = await sharp(photo).resize(maxW, maxH, { fit: "inside" }).png().toBuffer();
  const { width = maxW, height = maxH } = await sharp(resized).metadata();
  const mask = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}"/></svg>`);
  const rounded = await sharp(resized).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  if (!card) return { buf: rounded, width, height };
  const pad = 36;
  const cw = width + pad * 2;
  const ch = height + pad * 2;
  const cardSvg = Buffer.from(`<svg width="${cw}" height="${ch}"><rect width="${cw}" height="${ch}" rx="${radius + 16}" fill="${card}"/></svg>`);
  const buf = await sharp(cardSvg).composite([{ input: rounded, top: pad, left: pad }]).png().toBuffer();
  return { buf, width: cw, height: ch };
}

function shadow(width: number, height: number) {
  return Buffer.from(`<svg width="${width + 120}" height="${height + 120}"><defs><filter id="b"><feGaussianBlur stdDeviation="28"/></filter></defs><rect x="60" y="80" width="${width}" height="${height}" rx="60" fill="rgba(0,0,0,0.28)" filter="url(#b)"/></svg>`);
}

/** Background gradient + optional confetti (kept out of the text zone) + the product photo. */
export async function buildScene(photo: Buffer | Uint8Array, layout: Layout | "center", palette: ScenePalette, opts: { card?: string } = {}): Promise<Buffer> {
  const box = productBox(layout);
  const shapes: string[] = [];
  if (palette.busy) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const y = box.top - 60 + rnd() * (box.height + 120);
      shapes.push(`<circle cx="${Math.round(rnd() * W)}" cy="${Math.round(y)}" r="${Math.round(8 + rnd() * 36)}" fill="${palette.accent}" fill-opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`);
    }
  }
  const bg = Buffer.from(
    `<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>${shapes.join("")}</svg>`,
  );
  const p = await roundedPhoto(photo, 820, box.height - 80, 48, opts.card);
  const left = Math.round((W - p.width) / 2);
  const top = Math.round(box.top + (box.height - p.height) / 2);
  return sharp(bg)
    .composite([
      { input: shadow(p.width, p.height), top: top - 60, left: left - 60 },
      { input: p.buf, top, left },
    ])
    .png()
    .toBuffer();
}

const mix = (hex: string, toward: [number, number, number], t: number) => {
  const [r, g, b] = hexToRgb(hex);
  const c = [r, g, b].map((v, i) => Math.round(v + (toward[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** Product hero fallback: real product photo on a brand-color background, no generation. */
export async function buildHeroScene(photo: Buffer | Uint8Array, brandColor: string, layout: Layout): Promise<Buffer> {
  return buildScene(photo, layout, { from: mix(brandColor, [255, 255, 255], 0.15), to: mix(brandColor, [0, 0, 0], 0.12), accent: brandColor, busy: false }, { card: "#FFFFFF" });
}

/** Mock image model: reads the prompt's mood words and hex colors, so feedback visibly changes the output. */
export function paletteFromPrompt(prompt: string): ScenePalette {
  const p = prompt.toLowerCase();
  const hexes = [...prompt.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);
  const base = hexes[0] ?? "#F2C6DE";
  const calm = /avoid busy|minimal|clean|plain|simple|uncluttered|studio/.test(p);
  if (/premium|dark|night|luxur|moody|elegant/.test(p)) return { from: "#1B1B22", to: "#3A3442", accent: "#C9A86A", busy: !calm && /confetti|festive|party/.test(p) };
  if (/holiday|christmas|festive|warm|gift/.test(p)) return { from: mix(base, [255, 240, 230], 0.55), to: "#B8323E", accent: "#F4D35E", busy: !calm };
  return { from: mix(base, [255, 255, 255], 0.6), to: mix(base, [255, 255, 255], 0.1), accent: hexes[1] ?? "#FFFFFF", busy: !calm && /lifestyle|playful|fun|confetti|pattern/.test(p) };
}

export function layoutFromPrompt(prompt: string): Layout {
  const p = prompt.toLowerCase();
  if (/top (and|&) bottom|top 22%/.test(p)) return "split";
  if (/bottom (30%|third|area)|lower (third|30%)/.test(p)) return "bottom_card";
  return "top_headline";
}
