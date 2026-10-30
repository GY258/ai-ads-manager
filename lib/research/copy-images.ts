import sharp from "sharp";
import { setImageStored } from "@/lib/db/repo";
import type { ProductImage } from "@/lib/db/types";
import { upload, uploadFromUrl } from "@/lib/storage";
import { httpGet } from "@/lib/adapters/http";
import { sizedImageUrl } from "./shopify-url";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const isShopifyCdn = (u: string) => /cdn\.shopify\.com|\/cdn\/shop\//.test(u);

/** Copy one product image into Storage (idempotent) and record its real dimensions. */
export async function copyProductImage(brandId: string, img: ProductImage): Promise<ProductImage> {
  if (img.storage_path) return img;
  const res = await httpGet(isShopifyCdn(img.source_url) ? sizedImageUrl(img.source_url) : img.source_url);
  if (!res.ok) throw new Error(`image ${img.source_url}: HTTP ${res.status}`);
  const type = res.headers.get("content-type")?.split(";")[0] ?? "";
  const bytes = new Uint8Array(await res.arrayBuffer());
  const meta = await sharp(bytes).metadata();
  const ext = EXT[type] ?? (meta.format === "jpeg" ? "jpg" : meta.format) ?? "jpg";
  const path = `product-images/${brandId}/${img.product_id}/${img.position}.${ext}` as const;
  await upload(path, bytes, type || `image/${ext}`);
  await setImageStored(img.id, path, meta.width, meta.height);
  return { ...img, storage_path: path, width: meta.width ?? img.width, height: meta.height ?? img.height };
}

export async function copyLogo(brandId: string, url: string): Promise<string> {
  const res = await httpGet(isShopifyCdn(url) ? sizedImageUrl(url, 800) : url);
  if (!res.ok) throw new Error(`logo ${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Normalize to PNG so the compositor can always read it (favicons may be .ico/.svg).
  const png = await sharp(bytes, { density: 300 }).png().toBuffer();
  const path = `brand-assets/${brandId}/logo.png` as const;
  await upload(path, png, "image/png");
  return path;
}

export { uploadFromUrl };
