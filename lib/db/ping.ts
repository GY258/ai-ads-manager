import { env } from "@/lib/env";
import { getDb } from "./client";

/** `driver` lets external e2e runs refuse a deployment backed by the shared Postgres (tests overwrite brand kits). */
export async function pingDb(): Promise<{ ok: boolean; driver: "pglite" | "postgres"; error?: string }> {
  const driver = env().DB_DRIVER === "pglite" ? "pglite" : "postgres";
  try {
    const db = await getDb();
    const rows = await db.query<{ one: number }>("select 1 as one");
    return { ok: rows[0]?.one === 1, driver };
  } catch (e) {
    return { ok: false, driver, error: (e as Error).message };
  }
}
