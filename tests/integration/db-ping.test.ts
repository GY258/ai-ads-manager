import { describe, expect, it } from "vitest";
import { pingDb } from "@/lib/db/ping";
import { useFreshDb } from "../support/db";

describe("db", () => {
  const ref = useFreshDb();
  it("pings and applies every migration", async () => {
    expect(await pingDb()).toMatchObject({ ok: true });
    const rows = await ref.db.query<{ name: string }>("select name from _migrations order by name");
    expect(rows.map((r) => r.name)).toEqual(["0001_init.sql", "0002_schema.sql", "0003_spend_log.sql"]);
  });
});
