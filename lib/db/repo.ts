import { env } from "@/lib/env";
import { getDb, json, type Db } from "./client";
import { assertTransition, type AdStatus, type BrandStatus, type VariantStatus } from "./status";
import type { Ad, Brand, Campaign, Copy, EventRow, Feedback, Layout, Product, ProductImage, Variant } from "./types";

const uid = () => env().DEMO_USER_ID;
const one = <T>(rows: T[]): T | null => rows[0] ?? null;

const JSONB = new Set(["colors", "fonts", "source", "constraints", "copy", "qa", "parsed", "payload", "input", "output", "message", "response"]);

/** Build "set a = $2, b = $3" from a patch object, skipping undefined. jsonb columns are wrapped. */
function setClause(patch: Record<string, unknown>, offset = 1) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  return {
    sql: keys.map((k, i) => `${k} = $${i + offset}`).join(", "),
    values: keys.map((k) => (JSONB.has(k) ? json(patch[k]) : patch[k])),
    empty: keys.length === 0,
  };
}

// ── model cache ───────────────────────────────────────────────────────────────
export async function cacheGet(key: string): Promise<unknown | null> {
  const db = await getDb();
  return one(await db.query<{ response: unknown }>(`select response from model_cache where key = $1`, [key]))?.response ?? null;
}
export async function cachePut(key: string, response: unknown) {
  const db = await getDb();
  await db.query(`insert into model_cache (key, response) values ($1, $2) on conflict (key) do update set response = excluded.response`, [key, json(response)]);
}

// ── brands ────────────────────────────────────────────────────────────────────
export async function getBrand(id: string): Promise<Brand | null> {
  return one(await (await getDb()).query<Brand>(`select * from brands where id = $1`, [id]));
}
export async function getBrandByDomain(domain: string): Promise<Brand | null> {
  return one(await (await getDb()).query<Brand>(`select * from brands where domain = $1`, [domain]));
}
export async function listBrands(): Promise<Brand[]> {
  return (await getDb()).query<Brand>(`select * from brands where user_id = $1 and status <> 'failed' order by updated_at desc limit 20`, [uid()]);
}
/** Insert or reset a brand row to `researching` (one row per domain). */
export async function startBrandResearch(url: string, domain: string): Promise<Brand> {
  const db = await getDb();
  return (
    await db.query<Brand>(
      `insert into brands (user_id, url, domain, status) values ($1, $2, $3, 'researching')
       on conflict (domain) do update set url = excluded.url, status = 'researching'
       returning *`,
      [uid(), url, domain],
    )
  )[0];
}
export async function updateBrand(id: string, patch: Partial<Omit<Brand, "id" | "created_at" | "status">>): Promise<Brand> {
  const db = await getDb();
  const s = setClause(patch, 2);
  if (s.empty) return (await getBrand(id))!;
  return (await db.query<Brand>(`update brands set ${s.sql} where id = $1 returning *`, [id, ...s.values]))[0];
}
export async function setBrandStatus(id: string, to: BrandStatus): Promise<Brand> {
  return (await getDb()).tx(async (db) => {
    const cur = one(await db.query<Brand>(`select * from brands where id = $1 for update`, [id]));
    if (!cur) throw new Error(`brand ${id} not found`);
    assertTransition("brand", cur.status, to);
    return (await db.query<Brand>(`update brands set status = $2 where id = $1 returning *`, [id, to]))[0];
  });
}

// ── products ──────────────────────────────────────────────────────────────────
export type ProductInput = Omit<Product, "id" | "brand_id"> & { images: { source_url: string; width?: number | null; height?: number | null; position: number }[] };
export type ProductWithImages = Product & { images: ProductImage[] };

export async function upsertProducts(brandId: string, products: ProductInput[]): Promise<ProductWithImages[]> {
  return (await getDb()).tx(async (db) => {
    const out: ProductWithImages[] = [];
    for (const p of products) {
      const [row] = await db.query<Product>(
        `insert into products (user_id, brand_id, source_id, handle, title, description, price, currency, url, tags)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (brand_id, source_id) do update set handle = excluded.handle, title = excluded.title,
           description = excluded.description, price = excluded.price, currency = excluded.currency, url = excluded.url, tags = excluded.tags
         returning *`,
        [uid(), brandId, p.source_id, p.handle, p.title, p.description, p.price, p.currency, p.url, p.tags],
      );
      const images: ProductImage[] = [];
      for (const img of p.images) {
        const [ir] = await db.query<ProductImage>(
          `insert into product_images (user_id, product_id, source_url, width, height, position)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (product_id, position) do update set
             storage_path = case when product_images.source_url = excluded.source_url then product_images.storage_path else null end,
             source_url = excluded.source_url, width = excluded.width, height = excluded.height
           returning *`,
          [uid(), row.id, img.source_url, img.width ?? null, img.height ?? null, img.position],
        );
        images.push(ir);
      }
      out.push({ ...row, images });
    }
    return out;
  });
}

export async function listProducts(brandId: string): Promise<ProductWithImages[]> {
  const db = await getDb();
  const products = await db.query<Product>(`select * from products where brand_id = $1 order by created_at, title`, [brandId]);
  const images = await db.query<ProductImage>(
    `select pi.* from product_images pi join products p on p.id = pi.product_id where p.brand_id = $1 order by pi.position`,
    [brandId],
  );
  return products.map((p) => ({ ...p, images: images.filter((i) => i.product_id === p.id) }));
}
export async function getProduct(id: string): Promise<ProductWithImages | null> {
  const db = await getDb();
  const p = one(await db.query<Product>(`select * from products where id = $1`, [id]));
  if (!p) return null;
  return { ...p, images: await db.query<ProductImage>(`select * from product_images where product_id = $1 order by position`, [id]) };
}
export async function getProductImage(id: string): Promise<ProductImage | null> {
  return one(await (await getDb()).query<ProductImage>(`select * from product_images where id = $1`, [id]));
}
export async function setImageStored(id: string, storagePath: string, width?: number, height?: number) {
  await (await getDb()).query(`update product_images set storage_path = $2, width = coalesce($3, width), height = coalesce($4, height) where id = $1`, [id, storagePath, width ?? null, height ?? null]);
}

// ── campaigns ─────────────────────────────────────────────────────────────────
export async function createCampaign(storeUrl: string, name: string): Promise<Campaign> {
  return (await (await getDb()).query<Campaign>(`insert into campaigns (user_id, store_url, name) values ($1,$2,$3) returning *`, [uid(), storeUrl, name]))[0];
}
export async function getCampaign(id: string): Promise<Campaign | null> {
  return one(await (await getDb()).query<Campaign>(`select * from campaigns where id = $1`, [id]));
}
export async function listCampaigns(): Promise<(Campaign & { brand_name: string | null; ad_count: number })[]> {
  return (await getDb()).query(
    `select c.*, b.name as brand_name, (select count(*)::int from ads a where a.campaign_id = c.id) as ad_count
     from campaigns c left join brands b on b.id = c.brand_id where c.user_id = $1 order by c.updated_at desc limit 20`,
    [uid()],
  );
}
export async function updateCampaign(id: string, patch: Partial<Pick<Campaign, "brand_id" | "name" | "goal" | "offer" | "product_ids" | "status">>): Promise<Campaign> {
  const s = setClause(patch, 2);
  if (s.empty) return (await getCampaign(id))!;
  return (await (await getDb()).query<Campaign>(`update campaigns set ${s.sql} where id = $1 returning *`, [id, ...s.values]))[0];
}

/** Pure: append new constraints, dedupe case-insensitively, keep first wording and order. */
export function mergeConstraintList(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((c) => c.trim().toLowerCase()));
  const out = [...existing];
  for (const c of incoming) {
    const t = c.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
export async function mergeConstraints(campaignId: string, incoming: string[]): Promise<string[]> {
  return (await getDb()).tx(async (db) => {
    const cur = one(await db.query<Campaign>(`select * from campaigns where id = $1 for update`, [campaignId]));
    if (!cur) throw new Error(`campaign ${campaignId} not found`);
    const merged = mergeConstraintList(cur.constraints, incoming);
    await db.query(`update campaigns set constraints = $2 where id = $1`, [campaignId, json(merged)]);
    return merged;
  });
}

// ── ads ───────────────────────────────────────────────────────────────────────
export type AdInput = Pick<Ad, "product_id" | "product_image_id" | "angle" | "headline" | "cta" | "layout" | "scene_prompt"> & { subhead?: string | null };

export async function insertAds(campaignId: string, ads: AdInput[]): Promise<Ad[]> {
  return (await getDb()).tx(async (db) => {
    const out: Ad[] = [];
    for (const a of ads) {
      const [row] = await db.query<Ad>(
        `insert into ads (user_id, campaign_id, product_id, product_image_id, angle, headline, cta, subhead, layout, scene_prompt)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [uid(), campaignId, a.product_id, a.product_image_id, a.angle, a.headline, a.cta, a.subhead ?? null, a.layout, a.scene_prompt],
      );
      out.push(row);
    }
    return out;
  });
}
export async function getAd(id: string): Promise<Ad | null> {
  return one(await (await getDb()).query<Ad>(`select * from ads where id = $1`, [id]));
}
export async function listAds(campaignId: string): Promise<Ad[]> {
  return (await getDb()).query<Ad>(`select * from ads where campaign_id = $1 order by created_at, id`, [campaignId]);
}
export async function updateAd(id: string, patch: Partial<Pick<Ad, "headline" | "subhead" | "cta" | "layout" | "scene_prompt">>): Promise<Ad> {
  const s = setClause(patch, 2);
  if (s.empty) return (await getAd(id))!;
  return (await (await getDb()).query<Ad>(`update ads set ${s.sql} where id = $1 returning *`, [id, ...s.values]))[0];
}
export async function setAdStatus(id: string, to: AdStatus): Promise<Ad> {
  return (await getDb()).tx(async (db) => {
    const cur = one(await db.query<Ad>(`select * from ads where id = $1 for update`, [id]));
    if (!cur) throw new Error(`ad ${id} not found`);
    assertTransition("ad", cur.status, to);
    return (await db.query<Ad>(`update ads set status = $2 where id = $1 returning *`, [id, to]))[0];
  });
}
export async function setCurrentVariant(adId: string, variantId: string): Promise<Ad> {
  const db = await getDb();
  const rows = await db.query<Ad>(
    `update ads set current_variant_id = $2 where id = $1 and exists (select 1 from ad_variants v where v.id = $2 and v.ad_id = $1) returning *`,
    [adId, variantId],
  );
  if (!rows[0]) throw new Error(`variant ${variantId} does not belong to ad ${adId}`);
  return rows[0];
}
export async function adCounts(campaignId: string): Promise<Record<AdStatus | "total", number>> {
  const rows = await (await getDb()).query<{ status: AdStatus; n: number }>(`select status, count(*)::int as n from ads where campaign_id = $1 group by status`, [campaignId]);
  const c = { total: 0, draft: 0, approved: 0, rejected: 0 };
  for (const r of rows) {
    c[r.status] = r.n;
    c.total += r.n;
  }
  return c;
}

// ── variants ──────────────────────────────────────────────────────────────────
export type VariantInput = { ad_id: string; parent_variant_id?: string | null; layout: Layout; copy: Copy; prompt?: string | null; scene_path?: string | null; model?: string | null };

export async function insertVariant(v: VariantInput): Promise<Variant> {
  return (
    await (await getDb()).query<Variant>(
      `insert into ad_variants (user_id, ad_id, parent_variant_id, layout, copy, prompt, scene_path, model, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'queued') returning *`,
      [uid(), v.ad_id, v.parent_variant_id ?? null, v.layout, json(v.copy), v.prompt ?? null, v.scene_path ?? null, v.model ?? null],
    )
  )[0];
}
export async function getVariant(id: string): Promise<Variant | null> {
  return one(await (await getDb()).query<Variant>(`select * from ad_variants where id = $1`, [id]));
}
export async function listVariants(adId: string): Promise<Variant[]> {
  return (await getDb()).query<Variant>(`select * from ad_variants where ad_id = $1 order by created_at, id`, [adId]);
}
export async function listCampaignVariants(campaignId: string): Promise<Variant[]> {
  return (await getDb()).query<Variant>(`select v.* from ad_variants v join ads a on a.id = v.ad_id where a.campaign_id = $1 order by v.created_at`, [campaignId]);
}
export type VariantPatch = Partial<Pick<Variant, "scene_path" | "final_path" | "prompt" | "model" | "seed" | "layout" | "copy" | "error" | "qa" | "qa_status">>;

/** Update a variant, optionally moving its status (transition-checked inside a row lock). */
export async function updateVariant(id: string, patch: VariantPatch, to?: VariantStatus): Promise<Variant> {
  return (await getDb()).tx(async (db: Db) => {
    const cur = one(await db.query<Variant>(`select * from ad_variants where id = $1 for update`, [id]));
    if (!cur) throw new Error(`variant ${id} not found`);
    if (to) assertTransition("variant", cur.status, to);
    const s = setClause({ ...patch, status: to }, 2);
    if (s.empty) return cur;
    return (await db.query<Variant>(`update ad_variants set ${s.sql} where id = $1 returning *`, [id, ...s.values]))[0];
  });
}

// ── feedback, events, chat, tool runs ─────────────────────────────────────────
export async function insertFeedback(f: { campaign_id: string; ad_id?: string | null; variant_id?: string | null; text: string; parsed?: Feedback["parsed"]; applied?: boolean }): Promise<Feedback> {
  return (
    await (await getDb()).query<Feedback>(
      `insert into feedback (user_id, campaign_id, ad_id, variant_id, text, parsed, applied) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [uid(), f.campaign_id, f.ad_id ?? null, f.variant_id ?? null, f.text, json(f.parsed ?? {}), f.applied ?? false],
    )
  )[0];
}
export async function recentFeedback(campaignId: string, limit = 5): Promise<Feedback[]> {
  return (await getDb()).query<Feedback>(`select * from feedback where campaign_id = $1 order by created_at desc limit $2`, [campaignId, limit]);
}
export async function insertEvent(campaignId: string, type: string, payload: Record<string, unknown> = {}) {
  await (await getDb()).query(`insert into events (user_id, campaign_id, type, payload) values ($1,$2,$3,$4)`, [uid(), campaignId, type, json(payload)]);
}
export async function recentEvents(campaignId: string, limit = 5): Promise<EventRow[]> {
  return (await getDb()).query<EventRow>(`select * from events where campaign_id = $1 order by created_at desc, id desc limit $2`, [campaignId, limit]);
}

/** Replace the stored transcript with the client's current view (upsert by message id, keep order). */
export async function saveMessages(campaignId: string, messages: { id: string }[]) {
  await (await getDb()).tx(async (db) => {
    for (const [seq, m] of messages.entries()) {
      await db.query(
        `insert into chat_messages (user_id, campaign_id, message_id, message, seq) values ($1,$2,$3,$4,$5)
         on conflict (campaign_id, message_id) do update set message = excluded.message, seq = excluded.seq`,
        [uid(), campaignId, m.id, json(m), seq],
      );
    }
  });
}
export async function loadMessages<M>(campaignId: string): Promise<M[]> {
  const rows = await (await getDb()).query<{ message: M }>(`select message from chat_messages where campaign_id = $1 order by seq`, [campaignId]);
  return rows.map((r) => r.message);
}

export async function logToolRun(r: { tool: string; campaign_id?: string | null; input?: unknown; output?: unknown; error?: string | null; duration_ms: number; model_calls?: number }) {
  await (await getDb()).query(
    `insert into tool_runs (user_id, campaign_id, tool, input, output, error, duration_ms, model_calls) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [uid(), r.campaign_id ?? null, r.tool, json(r.input ?? null), json(r.output ?? null), r.error ?? null, r.duration_ms, r.model_calls ?? 0],
  );
}
