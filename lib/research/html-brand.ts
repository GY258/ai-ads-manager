import { decodeEntities, metaContent, resolveUrl, stripHtml } from "./html";

export type BrandSignals = {
  name: string | null;
  logoUrl: string | null;
  colors: string[];
  fonts: string[];
  tagline: string | null;
  description: string | null;
  text: string;
};

const GENERIC_FONTS = /^(inherit|initial|serif|sans-serif|monospace|system-ui|-apple-system|blinkmacsystemfont|var|helvetica|arial|times|segoe ui|san francisco|sf pro( display| text)?|cursive|fantasy|emoji|apple color emoji)$/i;
const NEUTRAL = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b) < 18; // greys, white, black
};

export function normalizeHex(c: string): string | null {
  const m = c.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1];
  return `#${h.toUpperCase()}`;
}

/** Fallback brand signals from plain HTML: og/meta tags, theme-color, favicon, CSS colors and font families. */
export function extractHtmlBrand(rawHtml: string, origin: string): BrandSignals {
  // Script blobs carry framework/theme colors (e.g. Tailwind palettes) that aren't the brand's; quote entities break font lists.
  const html = rawHtml.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/&#0?39;|&apos;|&quot;/g, "'");
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const siteName = metaContent(html, "og:site_name");
  const name = (siteName ?? (title ? decodeEntities(title).split(/[|–—-]/)[0] : null))?.replace(/[®™©]/g, " ").replace(/\s+/g, " ").trim() || null;

  const og = metaContent(html, "og:image:secure_url") ?? metaContent(html, "og:image");
  const favicon = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)?.[0].match(/href=["']([^"']+)["']/i)?.[1];
  const logoUrl = og ? resolveUrl(og, origin) : favicon ? resolveUrl(favicon, origin) : null;

  const counts = new Map<string, number>();
  const theme = normalizeHex(metaContent(html, "theme-color") ?? "");
  if (theme) counts.set(theme, 1000);
  for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g)) {
    const h = normalizeHex(m[0]);
    if (h && !NEUTRAL(h)) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 4);

  const fonts: string[] = [];
  for (const m of html.matchAll(/font-family:\s*([^;}<>]+)/gi)) {
    for (const f of m[1].split(",")) {
      const clean = decodeEntities(f).replace(/["']/g, "").replace(/!important/, "").trim();
      if (clean && !GENERIC_FONTS.test(clean) && !/icon|oke|var\(/i.test(clean) && !fonts.includes(clean)) fonts.push(clean);
    }
  }

  const description = metaContent(html, "description") ?? metaContent(html, "og:description");
  const ogTitle = metaContent(html, "og:title");
  const tagline = ogTitle?.split(/[|–—]/).slice(1).join(" ").trim() || null;
  return { name, logoUrl, colors, fonts: fonts.slice(0, 3), tagline, description, text: stripHtml(html).slice(0, 4000) };
}
