import type { AdStatus, BrandStatus, VariantStatus } from "./status";

export type Layout = "top_headline" | "bottom_card" | "split";
export type Angle = "social_proof" | "gift" | "problem_solution" | "lifestyle" | "offer" | "feature";
export type QaStatus = "pass" | "warn" | "fail" | "skipped";
export type FieldSource = "scraped" | "inferred" | "user" | "fallback";

export type Brand = {
  id: string;
  url: string;
  domain: string;
  name: string | null;
  logo_path: string | null;
  colors: string[];
  fonts: string[];
  voice: string | null;
  value_prop: string | null;
  audience: string | null;
  tone_words: string[];
  source: Record<string, FieldSource>;
  status: BrandStatus;
  created_at: Date;
};

export type Product = {
  id: string;
  brand_id: string;
  source_id: string;
  handle: string | null;
  title: string;
  description: string | null;
  price: string | null;
  currency: string | null;
  url: string | null;
  tags: string[];
};

export type ProductImage = {
  id: string;
  product_id: string;
  source_url: string;
  storage_path: string | null;
  width: number | null;
  height: number | null;
  position: number;
};

export type Campaign = {
  id: string;
  brand_id: string | null;
  store_url: string;
  name: string;
  goal: string | null;
  offer: string | null;
  product_ids: string[];
  constraints: string[];
  status: "researching" | "active" | "archived";
  created_at: Date;
};

export type Copy = { headline: string; subhead?: string | null; cta: string };

export type Ad = {
  id: string;
  campaign_id: string;
  product_id: string;
  product_image_id: string;
  angle: Angle;
  headline: string;
  cta: string;
  subhead: string | null;
  layout: Layout;
  scene_prompt: string;
  status: AdStatus;
  current_variant_id: string | null;
  created_at: Date;
};

export type Variant = {
  id: string;
  ad_id: string;
  parent_variant_id: string | null;
  scene_path: string | null;
  final_path: string | null;
  prompt: string | null;
  model: string | null;
  seed: string | null;
  layout: Layout;
  copy: Copy;
  status: VariantStatus;
  error: string | null;
  qa: Record<string, unknown>;
  qa_status: QaStatus | null;
  created_at: Date;
};

export type Feedback = {
  id: string;
  campaign_id: string;
  ad_id: string | null;
  variant_id: string | null;
  text: string;
  parsed: { constraints?: string[]; scope?: string; delta?: string };
  applied: boolean;
  created_at: Date;
};

export type EventRow = { id: string; campaign_id: string; type: string; payload: Record<string, unknown>; created_at: Date };
