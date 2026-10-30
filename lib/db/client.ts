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

let current: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!current) {
    // A failed connect must not poison the process: clear it so the next call retries.
    current = connect().catch((e) => {
      current = null;
      throw e;
    });
  }
  return current;
}

/** Tests inject an in-memory database. */
export function setDb(db: Db | null) {
  current = db ? Promise.resolve(db) : null;
}

async function connect(): Promise<Db> {
  const e = env();
  if (e.DB_DRIVER === "pglite") {
    const db = await createPglite(e.PGLITE_DIR);
    await migrate(db);
    return db;
  }
  return createPostgres(e.POSTGRES_URL!);
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

export async function createPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // Supabase pooler runs in transaction mode: no prepared statements.
  const sql = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    onnotice: () => {},
    // toPgParam already JSON-encodes; the default json serializer would encode it a second time.
    types: { json: { to: 3802, from: [114, 3802], serialize: (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)), parse: (x: string) => JSON.parse(x) } },
  });
  const wrap = (s: typeof sql): Db => ({
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await s.unsafe(text, params.map(toPgParam) as never[]);
      return rows as unknown as T[];
    },
    async exec(script) {
      await s.unsafe(script);
    },
    tx: (fn) => sql.begin((t) => fn(wrap(t as unknown as typeof sql))) as never,
    close: () => sql.end(),
  });
  return wrap(sql);
}

/** Marks a parameter as jsonb so arrays aren't turned into Postgres array literals. */
export class Json {
  constructor(readonly value: unknown) {}
}
export const json = (v: unknown) => new Json(v);

/** Plain objects go in as JSON text; arrays as Postgres array literals so both drivers agree. */
function toPgParam(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Json) return JSON.stringify(v.value);
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

