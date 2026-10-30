import { getDb } from "./client";

export async function pingDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await getDb();
    const rows = await db.query<{ one: number }>("select 1 as one");
    return { ok: rows[0]?.one === 1 };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
