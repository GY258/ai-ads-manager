import type { FontFamily } from "./font-catalog";
import { measure } from "./fonts";

export const HEADLINE_MAX_PX = 112;
export const HEADLINE_MIN_PX = 64;
export const HEADLINE_MAX_LINES = 3;

/** Greedy word wrap with real glyph advances. A word wider than the box returns null (can't fit). */
export function wrap(text: string, family: FontFamily, sizePx: number, maxWidth: number, bold = true, transform?: (s: string) => string): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const t = transform ?? ((s: string) => s);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(t(next), family, sizePx, bold) <= maxWidth) line = next;
    else {
      if (!line || measure(t(w), family, sizePx, bold) > maxWidth) return null;
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type Fit = { ok: true; sizePx: number; lines: string[] } | { ok: false; reason: "too_long" };

/** Start at 112px and step down to 64px until the headline fits in ≤ 3 lines. Below 64px: too long. */
export function fitHeadline(text: string, family: FontFamily, maxWidth: number, maxHeight: number, opts: { lineHeight?: number; uppercase?: boolean } = {}): Fit {
  const lh = opts.lineHeight ?? 1.05;
  const tf = opts.uppercase ? (s: string) => s.toUpperCase() : undefined;
  for (let size = HEADLINE_MAX_PX; size >= HEADLINE_MIN_PX; size -= 4) {
    // 4% slack: Satori's own line breaking can differ from ours by a few px.
    const lines = wrap(text, family, size, maxWidth * 0.96, true, tf);
    if (lines && lines.length <= HEADLINE_MAX_LINES && lines.length * size * lh <= maxHeight) return { ok: true, sizePx: size, lines };
  }
  return { ok: false, reason: "too_long" };
}
