import satori from "satori";
import sharp from "sharp";
import { closestFont, type FontFamily } from "./font-catalog";
import { satoriFonts } from "./fonts";
import { fitHeadline, HEADLINE_MIN_PX, wrap } from "./fit";
import { contrastRatio, H, hexLuminance, pickTreatment, SAFE, sampleZone, SYSTEM_UI_BOTTOM, textContrast, TEXT_DARK, TEXT_LIGHT, W, zonesFor, type Layout, type Treatment } from "./contrast";
import { CTA_FONT, CTA_H, geometry, LOGO_H, LOGO_MAX_W, overlay, type Copy, type Fitted, type Logo } from "./templates";
import { measure } from "./fonts";

export type ComposeInput = {
  scene: Buffer | Uint8Array;
  copy: Copy;
  kit: { colors: string[]; font: string };
  layout: Layout;
  logo?: Buffer | Uint8Array | null;
  /** Try other layouts when the preferred one fails layout QA (default true). */
  allowLayoutSwitch?: boolean;
  /** Scene QA said the text zone isn't clean: always lay a scrim under the text. */
  forceScrim?: boolean;
};

export type LayoutQa = {
  status: "pass" | "warn";
  size: { width: number; height: number };
  headline_px: number;
  contrast: number;
  cta_contrast: number;
  scrim: Treatment["scrim"];
  zone_stdev: number;
  safe_margins: boolean;
  layout_requested: Layout;
  layout_used: Layout;
  attempts: string[];
};

export type ComposeResult = { ok: true; png: Buffer; layout: Layout; qa: LayoutQa } | { ok: false; reason: "copy_too_long"; attempts: string[] };

const MIN_CONTRAST = 4.5;
const SUB_PX = 40;
const ORDER: Layout[] = ["top_headline", "bottom_card", "split"];

/** Exact 1080×1920 PNG, cover-cropped. */
export async function normalizeScene(scene: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(scene).resize(W, H, { fit: "cover", position: "centre" }).removeAlpha().png().toBuffer();
}

async function prepareLogo(logo?: Buffer | Uint8Array | null): Promise<Logo> {
  if (!logo) return null;
  try {
    const trimmed = await sharp(logo).trim().png().toBuffer().catch(() => sharp(logo).png().toBuffer());
    const meta = await sharp(trimmed).metadata();
    const scale = Math.min(LOGO_H / (meta.height ?? LOGO_H), LOGO_MAX_W / (meta.width ?? LOGO_MAX_W));
    const width = Math.round((meta.width ?? LOGO_H) * scale);
    const height = Math.round((meta.height ?? LOGO_H) * scale);
    const png = await sharp(trimmed).resize(width * 2, height * 2, { fit: "inside" }).png().toBuffer();
    return { dataUri: `data:image/png;base64,${png.toString("base64")}`, width, height };
  } catch {
    return null;
  }
}

function ctaStyle(brand: string, label: string) {
  const onLight = contrastRatio(hexLuminance(brand), hexLuminance(TEXT_DARK));
  const onDark = contrastRatio(hexLuminance(brand), 1);
  return { bg: brand, text: onLight >= onDark ? TEXT_DARK : TEXT_LIGHT, label, contrast: Math.max(onLight, onDark) };
}

/** Headline + subhead fit for one layout, or null if the headline can't fit at ≥ 64px. */
function fitFor(layout: Layout, copy: Copy, family: FontFamily, hasLogo: boolean): Fitted | null {
  const g = geometry(layout, hasLogo);
  const width = W - SAFE * 2;
  const subLines = copy.subhead ? wrap(copy.subhead, family, SUB_PX, width * 0.96, false) ?? [] : [];
  const subH = g.subInZone && subLines.length ? subLines.length * SUB_PX * 1.25 + 20 : 0;
  const head = fitHeadline(copy.headline, family, width, g.textMaxHeight - subH);
  if (!head.ok) {
    // Drop the subhead before giving up on the layout.
    if (subLines.length && g.subInZone) {
      const bare = fitHeadline(copy.headline, family, width, g.textMaxHeight);
      if (bare.ok) return { lines: bare.lines, sizePx: bare.sizePx, subLines: [], subPx: SUB_PX };
    }
    return null;
  }
  return { lines: head.lines, sizePx: head.sizePx, subLines: subLines.slice(0, 2), subPx: SUB_PX };
}

/**
 * Scene PNG + copy → final 1080×1920 ad. No model calls.
 * Layout QA: exact size, headline ≥ 64px, text contrast ≥ 4.5:1, CTA + logo inside safe margins.
 * On failure: add a scrim → try the other layouts → copy_too_long.
 */
export async function composeAd(input: ComposeInput): Promise<ComposeResult> {
  const scene = await normalizeScene(input.scene);
  const family = closestFont(input.kit.font);
  const brand = input.kit.colors[0] ?? "#111111";
  const logo = await prepareLogo(input.logo);
  const layouts = input.allowLayoutSwitch === false ? [input.layout] : [input.layout, ...ORDER.filter((l) => l !== input.layout)];
  const attempts: string[] = [];

  for (const layout of layouts) {
    const fit = fitFor(layout, input.copy, family, !!logo);
    if (!fit) {
      attempts.push(`${layout}: headline doesn't fit at ${HEADLINE_MIN_PX}px`);
      continue;
    }
    const stats = await sampleZone(scene, zonesFor(layout).headline);
    let t = pickTreatment(stats, layout, brand, !!input.forceScrim);
    let contrast = textContrast(stats, t);
    if (contrast < MIN_CONTRAST && !t.scrim) {
      attempts.push(`${layout}: contrast ${contrast.toFixed(2)} → scrim`);
      t = pickTreatment(stats, layout, brand, true);
      contrast = textContrast(stats, t);
    }
    if (contrast < MIN_CONTRAST && t.scrim?.kind === "card") {
      // Brand color too close to the text color: fall back to the dark gradient.
      t = { text: TEXT_LIGHT, scrim: { kind: "gradient", color: "#000000", opacity: 0.62 } };
      contrast = textContrast(stats, t);
    }
    if (contrast < MIN_CONTRAST) {
      attempts.push(`${layout}: contrast ${contrast.toFixed(2)} even with scrim`);
      continue;
    }
    // On a brand-color card the CTA would vanish into it: use the secondary color (or the text color) instead.
    const ctaBg = t.scrim?.kind === "card" ? (input.kit.colors.find((c) => c.toUpperCase() !== brand.toUpperCase()) ?? t.text) : brand;
    const cta = ctaStyle(ctaBg, input.copy.cta);
    const ctaWidth = measure(input.copy.cta, family, CTA_FONT) + 112;
    const g = geometry(layout, !!logo);
    const safe = ctaWidth <= W - SAFE * 2 && g.ctaTop + CTA_H <= H - SYSTEM_UI_BOTTOM && (!logo || (SAFE + (logo.width + 20) <= W - SAFE && SAFE + logo.height + 20 <= H));
    if (!safe) {
      attempts.push(`${layout}: CTA wider than safe area`);
      continue;
    }

    const svg = await satori(overlay(layout, fit, { colors: input.kit.colors, font: family }, t, cta, logo), { width: W, height: H, fonts: satoriFonts(family) });
    const png = await sharp(scene)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png({ compressionLevel: 8 })
      .toBuffer();
    const meta = await sharp(png).metadata();
    attempts.push(`${layout}: ok`);
    return {
      ok: true,
      png,
      layout,
      qa: {
        status: layout === input.layout ? "pass" : "warn",
        size: { width: meta.width!, height: meta.height! },
        headline_px: fit.sizePx,
        contrast: Math.round(contrast * 100) / 100,
        cta_contrast: Math.round(cta.contrast * 100) / 100,
        scrim: t.scrim,
        zone_stdev: Math.round(stats.stdev),
        safe_margins: safe,
        layout_requested: input.layout,
        layout_used: layout,
        attempts,
      },
    };
  }
  return { ok: false, reason: "copy_too_long", attempts };
}
