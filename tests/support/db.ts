import { afterAll, beforeAll } from "vitest";
import { createPglite, createPostgres, migrate, setDb, type Db } from "@/lib/db/client";

/** Fresh migrated database per test file. PGlite by default; TEST_DB_URL to run against a real Postgres. */
export function useFreshDb() {
  const ref: { db: Db } = {} as { db: Db };
  beforeAll(async () => {
    ref.db = process.env.TEST_DB_URL ? await createPostgres(process.env.TEST_DB_URL) : await createPglite();
    await migrate(ref.db);
    setDb(ref.db);
  });
  afterAll(async () => {
    await ref.db?.close();
    setDb(null);
  });
  return ref;
}
