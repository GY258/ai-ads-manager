import { env } from "@/lib/env";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** The only SQL surface in the app. Repository functions in lib/db use it; tools never do. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Multi-statement script, no params (migrations). */
  exec(script: string): Promise<void>;
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

// One connection per process, on globalThis: Next bundles pages, route handlers and server actions as separate
// module instances, and two PGlite instances on one data dir silently diverge.
const g = globalThis as unknown as { __adsDb?: Promise<Db> | null };

export function getDb(): Promise<Db> {
  if (!g.__adsDb) {
    // A failed connect must not poison the process: clear it so the next call retries.
    g.__adsDb = connect().catch((e) => {
      g.__adsDb = null;
      throw e;
    });
  }
  return g.__adsDb;
}

/** Tests inject an in-memory database. */
export function setDb(db: Db | null) {
  g.__adsDb = db ? Promise.resolve(db) : null;
}

async function connect(): Promise<Db> {
  const e = env();
  if (e.DB_DRIVER === "pglite") {
    const db = await createPglite(e.PGLITE_DIR);
    await migrate(db);
    return db;
  }
  // Mock data in the shared Postgres leaks into the live app (an e2e run once re-confirmed Loopy's kit in pink).
  if (e.AI_MODE === "mock" && process.env.ALLOW_MOCK_ON_POSTGRES !== "1") {
    throw new Error("AI_MODE=mock must not use the shared Postgres. Set DB_DRIVER=pglite (see .env.example) or AI_MODE=live.");
  }
  return createPostgres(e.POSTGRES_URL ?? e.POSTGRES_URL_NON_POOLING!);
}

export async function createPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  }
  const pg = new PGlite(dataDir);
  type Q = { query: typeof pg.query; exec: typeof pg.exec };
  const wrap = (q: Q): Db => ({
    async query<T>(text: string, params: unknown[] = []) {
      const res = await q.query<T>(text, params.map(toPgParam));
      return res.rows;
    },
    async exec(script) {
      await q.exec(script);
    },
    tx: (fn) => pg.transaction((t) => fn(wrap(t as unknown as Q))),
    close: () => pg.close(),
  });
  return wrap(pg);
}

/**
 * node-postgres Pool on Supabase's transaction pooler (:6543). One query at a time per client — no pipelining,
 * which the transaction pooler silently broke with postgres.js — and the pooler multiplexes many serverless
 * instances onto few server connections (the session pooler capped us at 15 clients and refused page loads).
 */
export async function createPostgres(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  // uuid[] isn't parsed by default; reuse the text[] parser.
  pg.types.setTypeParser(2951 as never, pg.types.getTypeParser(1009 as never));
  // pg treats sslmode=require as verify-full; Supabase's pooler cert needs rejectUnauthorized: false instead.
  const u = new URL(url);
  u.searchParams.delete("sslmode");
  const pool = new pg.Pool({ connectionString: u.toString(), ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
  pool.on("error", (e) => console.error("[pg pool]", e.message));
  type Q = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
  const inflight = new Map<number, string>();
  let qid = 0;
  if (process.env.DB_DEBUG) setInterval(() => inflight.size && console.log("[db inflight]", [...inflight.values()].map((q) => q.slice(0, 90)).join(" || ")), 5000).unref();
  const wrap = (q: Q, label: string): Omit<Db, "tx" | "close"> => ({
    async query<T>(text: string, params: unknown[] = []) {
      const id = qid++;
      inflight.set(id, `${label}: ${text.replace(/\s+/g, " ")}`);
      try {
        return (await q.query(text, params.map(toPgParam))).rows as T[];
      } finally {
        inflight.delete(id);
      }
    },
    async exec(script) {
      await q.query(script);
    },
  });
  const db: Db = {
    ...wrap(pool, "pool"),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const inner: Db = { ...wrap(client, "tx"), tx: (f) => f(inner), close: async () => {} };
        const out = await fn(inner);
        await client.query("commit");
        return out;
      } catch (e) {
        await client.query("rollback").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return db;
}

/**
 * Marks a parameter as jsonb so arrays aren't turned into Postgres array literals.
 * Branded with a global symbol, not a class: Next loads this module once per bundle, and the shared
 * connection may come from another bundle, where `instanceof` would silently fail.
 */
const JSON_BRAND = Symbol.for("ai-ads-manager.jsonb");
export type Json = { [JSON_BRAND]: true; value: unknown };
export const json = (v: unknown): Json => ({ [JSON_BRAND]: true, value: v });
const isJson = (v: unknown): v is Json => !!v && typeof v === "object" && (v as Record<symbol, unknown>)[JSON_BRAND] === true;

/** Plain objects go in as JSON text; arrays as Postgres array literals so both drivers agree. */
function toPgParam(v: unknown): unknown {
  if (v === undefined) return null;
  if (isJson(v)) return JSON.stringify(v.value);
  if (Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
  if (v && typeof v === "object" && !(v instanceof Date) && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export async function migrate(db: Db): Promise<string[]> {
  await db.query(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query<{ name: string }>(`select name from _migrations`)).map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const text = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    await db.tx(async (t) => {
      await t.exec(text);
      await t.query(`insert into _migrations (name) values ($1)`, [f]);
    });
    applied.push(f);
  }
  return applied;
}

