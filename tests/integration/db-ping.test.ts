import { afterAll, describe, expect, it } from "vitest";
import { getDb, setDb } from "@/lib/db/client";
import { pingDb } from "@/lib/db/ping";

describe("db", () => {
  afterAll(async () => {
    await (await getDb()).close();
    setDb(null);
  });
  it("pings and applies migrations", async () => {
    expect(await pingDb()).toEqual({ ok: true });
    const rows = await (await getDb()).query<{ name: string }>("select name from _migrations");
    expect(rows.length).toBeGreaterThan(0);
  });
});
