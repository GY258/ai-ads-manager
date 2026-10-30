import { getDb } from "./client";

export async function cacheGet(key: string): Promise<unknown | null> {
  const db = await getDb();
  const rows = await db.query<{ response: unknown }>(`select response from model_cache where key = $1`, [key]);
  return rows[0]?.response ?? null;
}

export async function cachePut(key: string, response: unknown) {
  const db = await getDb();
  await db.query(`insert into model_cache (key, response) values ($1, $2) on conflict (key) do update set response = excluded.response`, [key, response]);
}
