// Applies supabase/migrations/*.sql to the Supabase database (direct connection, not the pooler).
import { config } from "dotenv";
config({ path: ".env.local" });
import { createPostgres, migrate } from "../lib/db/client";

async function main() {
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL_NON_POOLING missing; run `vercel env pull .env.local`");
  const db = await createPostgres(url);
  const applied = await migrate(db);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
  await db.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
