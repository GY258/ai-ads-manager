import * as repo from "@/lib/db/repo";
import type { FieldSource } from "@/lib/db/types";
import { brandKitSchema, type BrandKit } from "@/lib/agent/schemas";
import { copyProductImage } from "@/lib/research/copy-images";
import { publicUrl } from "@/lib/storage";
import { mapLimit } from "@/lib/util";

/** Everything BrandKitForm needs, with public image URLs. Lazily copies a few product photos for the picker. */
export async function getBrandKitData(brandId: string) {
  const brand = await repo.getBrand(brandId);
  if (!brand) throw new Error("brand not found");
  const products = (await repo.listProducts(brandId)).filter((p) => p.images.length);
  const heroIds = ((brand.source as Record<string, unknown>).hero_product_ids as string[]) ?? [];
  const ordered = [...products.filter((p) => heroIds.includes(p.id)), ...products.filter((p) => !heroIds.includes(p.id))].slice(0, 24);
  const withThumbs = await mapLimit(ordered, 6, async (p) => {
    const first = await copyProductImage(brandId, p.images[0]).catch(() => null);
    return { id: p.id, title: p.title, price: p.price, currency: p.currency, image_url: first?.storage_path ? publicUrl(first.storage_path) : null };
  });
  return {
    brand: {
      id: brand.id,
      name: brand.name ?? brand.domain,
      domain: brand.domain,
      logo_url: brand.logo_path ? publicUrl(brand.logo_path) : null,
      colors: brand.colors,
      fonts: brand.fonts,
      voice: brand.voice ?? "",
      audience: brand.audience ?? "",
      value_prop: brand.value_prop ?? "",
      tone_words: brand.tone_words,
      status: brand.status,
      source: brand.source,
    },
    products: withThumbs.filter((p) => p.image_url),
    heroIds,
  };
}
export type BrandKitData = Awaited<ReturnType<typeof getBrandKitData>>;

const splitList = (s?: string) => (s ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

/** Persist the user's confirmed kit: user edits win over inferred values, brand → confirmed, campaign gets products/goal. */
export async function confirmBrandKit(campaignId: string, brandId: string, input: BrandKit) {
  const kit = brandKitSchema.parse(input);
  const brand = await repo.getBrand(brandId);
  if (!brand) throw new Error("brand not found");
  const products = await Promise.all(kit.product_ids.map((id) => repo.getProduct(id)));
  if (products.some((p) => !p || p.brand_id !== brandId)) throw new Error("selected products must belong to this brand");

  const source: Record<string, FieldSource> = { ...(brand.source as Record<string, FieldSource>) };
  const mark = (field: string, changed: boolean) => {
    if (changed) source[field] = "user";
  };
  mark("name", kit.name !== brand.name);
  mark("colors", JSON.stringify(kit.colors.map((c) => c.toUpperCase())) !== JSON.stringify(brand.colors));
  mark("fonts", kit.font !== brand.fonts[0]);
  mark("voice", kit.voice !== brand.voice);
  mark("audience", kit.audience !== brand.audience);
  if (kit.value_prop !== undefined) mark("value_prop", kit.value_prop !== brand.value_prop);

  await repo.updateBrand(brandId, {
    name: kit.name,
    colors: kit.colors.map((c) => c.toUpperCase()),
    fonts: [kit.font, ...brand.fonts.filter((f) => f !== kit.font)],
    voice: kit.voice,
    audience: kit.audience,
    value_prop: kit.value_prop ?? brand.value_prop,
    tone_words: kit.tone_words.length ? kit.tone_words : brand.tone_words,
    source: source as never,
  });
  if (brand.status !== "confirmed") await repo.setBrandStatus(brandId, "confirmed");

  // Copy the first two photos of each selected product now (others were lazy).
  await mapLimit(products.flatMap((p) => p!.images.slice(0, 2)), 4, (img) => copyProductImage(brandId, img).catch(() => null));

  const campaign = await repo.updateCampaign(campaignId, {
    brand_id: brandId,
    product_ids: kit.product_ids,
    goal: kit.goal,
    offer: kit.offer || null,
    status: "active",
    name: `${kit.name} — ${kit.goal}`.slice(0, 120),
  });
  const constraints = splitList(kit.avoid).map((a) => (/^(avoid|no|don'?t)\b/i.test(a) ? a : `avoid ${a}`));
  if (constraints.length) await repo.mergeConstraints(campaignId, constraints);
  await repo.insertEvent(campaignId, "brand_kit_confirmed", { brandId });
  return {
    brandId,
    campaignId: campaign.id,
    name: kit.name,
    colors: kit.colors,
    font: kit.font,
    products: products.map((p) => ({ id: p!.id, title: p!.title })),
    goal: kit.goal,
    offer: kit.offer ?? null,
    constraints,
    edited_fields: Object.entries(source).filter(([, v]) => v === "user").map(([k]) => k),
  };
}
