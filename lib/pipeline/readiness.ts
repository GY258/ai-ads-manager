import type { LayoutQa } from "@/lib/compose/compose";

/** Open-ended feature: a placement-readiness score per ad, from QA data we already store. No model calls. */
export type ReadinessCheck = { id: string; label: string; score: number; weight: number; detail: string };
export type Readiness = { score: number; grade: "ready" | "ok" | "fix"; checks: ReadinessCheck[] };

const PHONE_WIDTH = 390; // CSS px of a typical phone; the ad is 1080 wide

export function readiness(qa: { layout?: Partial<LayoutQa>; scene?: { product_match?: string; skipped?: boolean; fallback_reason?: string }; fallback?: boolean } | null | undefined): Readiness | null {
  const l = qa?.layout;
  if (!l?.headline_px || !l.contrast) return null;
  const phonePx = Math.round((l.headline_px * PHONE_WIDTH) / 1080);
  const checks: ReadinessCheck[] = [
    { id: "text_size", label: "Headline size on a phone", weight: 25, score: phonePx >= 30 ? 1 : phonePx >= 24 ? 0.7 : 0.3, detail: `${phonePx}px at phone width` },
    { id: "contrast", label: "Headline contrast", weight: 25, score: l.contrast >= 7 ? 1 : l.contrast >= 4.5 ? 0.7 : 0.2, detail: `${l.contrast}:1` },
    { id: "cta", label: "CTA legibility", weight: 15, score: (l.cta_contrast ?? 0) >= 4.5 ? 1 : (l.cta_contrast ?? 0) >= 3 ? 0.6 : 0.2, detail: `${l.cta_contrast ?? "?"}:1` },
    {
      id: "product",
      label: "Product fidelity",
      weight: 25,
      score: qa?.fallback ? 0.8 : qa?.scene?.product_match === "pass" ? 1 : qa?.scene?.product_match === "warn" ? 0.6 : qa?.scene?.skipped ? 0.75 : 0.3,
      detail: qa?.fallback ? "real product photo (fallback)" : qa?.scene?.product_match ? `vision QA: ${qa.scene.product_match}` : "not checked",
    },
    { id: "safe", label: "Safe zones", weight: 10, score: l.safe_margins ? 1 : 0, detail: l.safe_margins ? "text clear of edges and system UI" : "text near edges" },
  ];
  const score = Math.round(checks.reduce((s, c) => s + c.score * c.weight, 0));
  return { score, grade: score >= 85 ? "ready" : score >= 65 ? "ok" : "fix", checks };
}
