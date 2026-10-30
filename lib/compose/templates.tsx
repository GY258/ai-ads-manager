import type { ReactElement } from "react";
import { H, SAFE, SYSTEM_UI_BOTTOM, W, type Layout, type Treatment } from "./contrast";

export type Copy = { headline: string; subhead?: string | null; cta: string };
export type Kit = { colors: string[]; font: string };
export type Logo = { dataUri: string; width: number; height: number } | null;
export type Fitted = { lines: string[]; sizePx: number; subLines: string[]; subPx: number };
export type CtaStyle = { bg: string; text: string; label: string };

export const CTA_H = 88;
export const CTA_FONT = 40;
export const LOGO_H = 64;
export const LOGO_MAX_W = 260;

/** Geometry per layout, shared by the fitter (budgets) and the templates (placement). */
export function geometry(layout: Layout, hasLogo: boolean) {
  const logoBlock = hasLogo ? LOGO_H + 40 : 0;
  const ctaBottom = H - SYSTEM_UI_BOTTOM - 40;
  switch (layout) {
    case "top_headline": {
      const top = SAFE + logoBlock;
      return { textTop: top, textMaxHeight: Math.round(H * 0.32) - top - 24, ctaTop: ctaBottom - CTA_H, subInZone: true, zoneEdge: "top" as const };
    }
    case "bottom_card": {
      const zoneTop = Math.round(H * 0.7);
      const cardTop = zoneTop + 8;
      return { textTop: cardTop + 48, textMaxHeight: ctaBottom - CTA_H - 32 - (cardTop + 48), ctaTop: ctaBottom - CTA_H, subInZone: true, zoneEdge: "bottom" as const, cardTop };
    }
    case "split": {
      const top = SAFE + logoBlock;
      return { textTop: top, textMaxHeight: Math.round(H * 0.22) - top - 8, ctaTop: ctaBottom - CTA_H, subInZone: false, zoneEdge: "top" as const };
    }
  }
}

function Scrim({ t, layout, cardTop }: { t: Treatment; layout: Layout; cardTop?: number }) {
  if (!t.scrim) return null;
  if (t.scrim.kind === "card") {
    const top = cardTop ?? Math.round(H * 0.7);
    return <div style={{ position: "absolute", left: 32, right: 32, top, bottom: SYSTEM_UI_BOTTOM - 16, borderRadius: 48, backgroundColor: t.scrim.color, opacity: t.scrim.opacity }} />;
  }
  const a = t.scrim.opacity;
  if (layout === "bottom_card") {
    return <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: Math.round(H * 0.42), backgroundImage: `linear-gradient(to top, rgba(0,0,0,${a}) 55%, rgba(0,0,0,0))` }} />;
  }
  const h = layout === "split" ? Math.round(H * 0.3) : Math.round(H * 0.42);
  return <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: h, backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,${a}) 55%, rgba(0,0,0,0))` }} />;
}

function Lines({ lines, size, color, weight, family, lh = 1.05 }: { lines: string[]; size: number; color: string; weight: 400 | 800; family: string; lh?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", fontFamily: family, fontSize: size, fontWeight: weight, color, lineHeight: lh, letterSpacing: weight === 800 ? -1 : 0, whiteSpace: "nowrap" }}>
          {l}
        </div>
      ))}
    </div>
  );
}

function Cta({ label, style, family, top }: { label: string; style: Omit<CtaStyle, "label">; family: string; top: number }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: CTA_H, paddingLeft: 56, paddingRight: 56, borderRadius: CTA_H / 2, backgroundColor: style.bg, color: style.text, fontFamily: family, fontWeight: 800, fontSize: CTA_FONT }}>
        {label}
      </div>
    </div>
  );
}

function LogoChip({ logo }: { logo: Logo }) {
  if (!logo) return null;
  return (
    <div style={{ position: "absolute", left: SAFE, top: SAFE, display: "flex", padding: 10, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.88)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={logo.dataUri} width={logo.width} height={logo.height} style={{ width: logo.width, height: logo.height }} />
    </div>
  );
}

/** Pure template: (copy, kit, contrast) → overlay JSX for a 1080×1920 canvas. */
export function overlay(layout: Layout, fit: Fitted, kit: Kit, t: Treatment, cta: CtaStyle, logo: Logo): ReactElement {
  const g = geometry(layout, !!logo);
  const family = kit.font;
  const textBlock = (
    <div style={{ position: "absolute", left: SAFE, right: SAFE, top: g.textTop, display: "flex", flexDirection: "column", gap: 20 }}>
      <Lines lines={fit.lines} size={fit.sizePx} color={t.text} weight={800} family={family} />
      {g.subInZone && fit.subLines.length > 0 && <Lines lines={fit.subLines} size={fit.subPx} color={t.text} weight={400} family={family} lh={1.25} />}
    </div>
  );
  return (
    <div style={{ display: "flex", position: "relative", width: W, height: H }}>
      <Scrim t={t} layout={layout} cardTop={"cardTop" in g ? g.cardTop : undefined} />
      <LogoChip logo={logo} />
      {textBlock}
      {!g.subInZone && fit.subLines.length > 0 && (
        <div style={{ position: "absolute", left: SAFE, right: SAFE, top: g.ctaTop - 24 - fit.subLines.length * fit.subPx * 1.25, display: "flex", justifyContent: "center" }}>
          <div style={{ display: "flex", padding: "8px 20px", borderRadius: 16, backgroundColor: "rgba(0,0,0,0.45)" }}>
            <Lines lines={fit.subLines} size={fit.subPx} color="#FFFFFF" weight={400} family={family} lh={1.25} />
          </div>
        </div>
      )}
      <Cta label={cta.label} style={cta} family={family} top={g.ctaTop} />
    </div>
  );
}
