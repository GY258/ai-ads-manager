import sharp from "sharp";

export const W = 1080;
export const H = 1920;
export const SAFE = 64;
export const SYSTEM_UI_BOTTOM = 120; // keep key text out of the bottom 120px (interstitial system UI)

export type Layout = "top_headline" | "bottom_card" | "split";
export type Zone = { left: number; top: number; width: number; height: number };

/** Text zones per layout: top 32% · bottom 30% · split = top 22% headline + bottom 14% CTA. */
export function zonesFor(layout: Layout): { headline: Zone; cta: Zone } {
  const z = (topPct: number, hPct: number): Zone => ({ left: 0, top: Math.round(H * topPct), width: W, height: Math.round(H * hPct) });
  switch (layout) {
    case "top_headline":
      return { headline: z(0, 0.32), cta: z(0.32 - 0.1, 0.1) };
    case "bottom_card":
      return { headline: z(0.7, 0.3), cta: z(0.7, 0.3) };
    case "split":
      return { headline: z(0, 0.22), cta: z(0.86, 0.14) };
  }
}

export type ZoneStats = { r: number; g: number; b: number; luminance: number; stdev: number };

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const relLuminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrastRatio = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
export const hexLuminance = (hex: string) => relLuminance(...hexToRgb(hex));

/** Mean color + spread of a zone, via sharp().extract().stats(). */
export async function sampleZone(scene: Buffer, zone: Zone): Promise<ZoneStats> {
  const { channels } = await sharp(scene).extract(zone).removeAlpha().stats();
  const [r, g, b] = channels.map((c) => c.mean);
  const stdev = (channels[0].stdev + channels[1].stdev + channels[2].stdev) / 3;
  return { r, g, b, luminance: relLuminance(r, g, b), stdev };
}

export const BUSY_STDEV = 38;
export const TEXT_DARK = "#111111";
export const TEXT_LIGHT = "#FFFFFF";

export type Treatment = { text: string; scrim: null | { kind: "gradient" | "card"; color: string; opacity: number } };

/** White or near-black text; busy zones get a scrim (gradient for edge layouts, brand-color card otherwise). */
export function pickTreatment(stats: ZoneStats, layout: Layout, brandColor: string, forceScrim = false): Treatment {
  const busy = forceScrim || stats.stdev > BUSY_STDEV;
  if (!busy) {
    const dark = contrastRatio(stats.luminance, hexLuminance(TEXT_DARK));
    const light = contrastRatio(stats.luminance, 1);
    return { text: dark >= light ? TEXT_DARK : TEXT_LIGHT, scrim: null };
  }
  if (layout === "bottom_card") {
    const textOnBrand = contrastRatio(hexLuminance(brandColor), 1) >= contrastRatio(hexLuminance(brandColor), hexLuminance(TEXT_DARK)) ? TEXT_LIGHT : TEXT_DARK;
    return { text: textOnBrand, scrim: { kind: "card", color: brandColor, opacity: 0.85 } };
  }
  // Gradient scrim: darken toward the edge, white text.
  return { text: TEXT_LIGHT, scrim: { kind: "gradient", color: "#000000", opacity: 0.62 } };
}

/** Effective background behind the text after the scrim is applied (alpha blend of mean color). */
export function effectiveBackground(stats: ZoneStats, t: Treatment): number {
  if (!t.scrim) return stats.luminance;
  const [sr, sg, sb] = hexToRgb(t.scrim.color);
  const a = t.scrim.opacity;
  return relLuminance(stats.r * (1 - a) + sr * a, stats.g * (1 - a) + sg * a, stats.b * (1 - a) + sb * a);
}

export function textContrast(stats: ZoneStats, t: Treatment): number {
  return contrastRatio(effectiveBackground(stats, t), hexLuminance(t.text));
}
