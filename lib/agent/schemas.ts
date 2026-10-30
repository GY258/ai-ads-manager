import { z } from "zod";

export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "must be a #RRGGBB hex color");

export const brandSynthesisSchema = z.object({
  name: z.string().min(1),
  voice: z.string().min(1).describe("2-6 words describing how the brand talks"),
  value_prop: z.string().min(1).describe("one sentence: why customers buy"),
  audience: z.string().min(1).describe("who buys, one short phrase"),
  tone_words: z.array(z.string()).min(2).max(6),
  suggested_hero_product_ids: z.array(z.string()).min(1).max(3),
});
export type BrandSynthesis = z.infer<typeof brandSynthesisSchema>;

/** What the user confirms in BrandKitForm. */
export const brandKitSchema = z.object({
  name: z.string().min(1),
  colors: z.array(hexColor).min(1).max(5),
  font: z.string().min(1),
  voice: z.string().min(1),
  audience: z.string().min(1),
  value_prop: z.string().optional(),
  tone_words: z.array(z.string()).default([]),
  product_ids: z.array(z.string().uuid()).min(1).max(3),
  goal: z.string().min(1),
  offer: z.string().optional(),
  avoid: z.string().optional(),
});
export type BrandKit = z.infer<typeof brandKitSchema>;

export const COPY_LIMITS = { headline: 6, subhead: 12, cta: 3 } as const;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const words = (max: number) => (s: string) => wordCount(s) <= max;

export const copySchema = z.object({
  headline: z.string().min(1).refine(words(COPY_LIMITS.headline), `headline must be ≤ ${COPY_LIMITS.headline} words`),
  subhead: z.string().refine(words(COPY_LIMITS.subhead), `subhead must be ≤ ${COPY_LIMITS.subhead} words`).nullish(),
  cta: z.string().min(1).refine(words(COPY_LIMITS.cta), `CTA must be ≤ ${COPY_LIMITS.cta} words`),
});
