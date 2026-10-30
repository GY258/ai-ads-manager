import "server-only";
import { env } from "@/lib/env";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

export const BUCKETS = ["brand-assets", "product-images", "ad-scenes", "ad-finals"] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface StorageDriver {
  put(bucket: Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Uint8Array>;
  exists(bucket: Bucket, key: string): Promise<boolean>;
  publicUrl(bucket: Bucket, key: string): string;
  ensureBuckets(): Promise<void>;
}

export function storage(): StorageDriver {
  const e = env();
  return e.STORAGE_DRIVER === "local" ? localDriver(e.LOCAL_STORAGE_DIR) : supabaseDriver();
}

/** Storage path as saved in the DB: "bucket/key". */
export type StoragePath = `${Bucket}/${string}`;

export function splitPath(p: string): [Bucket, string] {
  const i = p.indexOf("/");
  const bucket = p.slice(0, i) as Bucket;
  if (!BUCKETS.includes(bucket)) throw new Error(`bad storage path: ${p}`);
  return [bucket, p.slice(i + 1)];
}

export async function upload(p: StoragePath, bytes: Uint8Array, contentType: string): Promise<StoragePath> {
  const [b, k] = splitPath(p);
  await storage().put(b, k, bytes, contentType);
  return p;
}

export async function download(p: string): Promise<Uint8Array> {
  const [b, k] = splitPath(p);
  return storage().get(b, k);
}

export function publicUrl(p: string): string {
  const [b, k] = splitPath(p);
  return storage().publicUrl(b, k);
}

/** Copy a remote file (fal, Shopify CDN) into our bucket. The remote URL is never the only copy. */
export async function uploadFromUrl(p: StoragePath, url: string): Promise<{ path: StoragePath; contentType: string; bytes: Uint8Array }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const contentType = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  const bytes = new Uint8Array(await res.arrayBuffer());
  await upload(p, bytes, contentType);
  return { path: p, contentType, bytes };
}

export async function checkStorage(): Promise<{ ok: boolean; error?: string }> {
  try {
    const s = storage();
    await s.ensureBuckets();
    const key = "_health/ping.txt";
    await s.put("ad-finals", key, new TextEncoder().encode("ok"), "text/plain");
    const back = new TextDecoder().decode(await s.get("ad-finals", key));
    return back === "ok" ? { ok: true } : { ok: false, error: "round-trip mismatch" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function localDriver(root: string): StorageDriver {
  const file = (b: Bucket, k: string) => {
    const full = path.resolve(root, b, k);
    if (!full.startsWith(path.resolve(root))) throw new Error("path escapes storage root");
    return full;
  };
  return {
    async put(b, k, bytes) {
      await mkdir(path.dirname(file(b, k)), { recursive: true });
      await writeFile(file(b, k), bytes);
    },
    async get(b, k) {
      return new Uint8Array(await readFile(file(b, k)));
    },
    async exists(b, k) {
      return stat(file(b, k)).then(() => true, () => false);
    },
    publicUrl: (b, k) => `${env().APP_URL ?? ""}/api/local-storage/${b}/${k}`,
    async ensureBuckets() {
      for (const b of BUCKETS) await mkdir(path.resolve(root, b), { recursive: true });
    },
  };
}

function supabaseDriver(): StorageDriver {
  const e = env();
  const base = e.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, apikey: e.SUPABASE_SERVICE_ROLE_KEY! };
  const objUrl = (b: Bucket, k: string) => `${base}/storage/v1/object/${b}/${k.split("/").map(encodeURIComponent).join("/")}`;
  return {
    async put(b, k, bytes, contentType) {
      const res = await fetch(objUrl(b, k), {
        method: "POST",
        headers: { ...headers, "content-type": contentType, "x-upsert": "true", "cache-control": "max-age=31536000" },
        body: Buffer.from(bytes),
      });
      if (!res.ok) throw new Error(`storage put ${b}/${k}: ${res.status} ${await res.text()}`);
    },
    async get(b, k) {
      const res = await fetch(objUrl(b, k), { headers });
      if (!res.ok) throw new Error(`storage get ${b}/${k}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async exists(b, k) {
      const res = await fetch(objUrl(b, k), { method: "HEAD", headers });
      return res.ok;
    },
    publicUrl: (b, k) => `${base}/storage/v1/object/public/${b}/${k.split("/").map(encodeURIComponent).join("/")}`,
    async ensureBuckets() {
      const res = await fetch(`${base}/storage/v1/bucket`, { headers });
      if (!res.ok) throw new Error(`list buckets: ${res.status}`);
      const have = new Set(((await res.json()) as { id: string }[]).map((x) => x.id));
      for (const b of BUCKETS) {
        if (have.has(b)) continue;
        const r = await fetch(`${base}/storage/v1/bucket`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ id: b, name: b, public: true }),
        });
        if (!r.ok && r.status !== 409) throw new Error(`create bucket ${b}: ${r.status} ${await r.text()}`);
      }
    },
  };
}
