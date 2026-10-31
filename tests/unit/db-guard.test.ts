import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, setDb } from "@/lib/db/client";

describe("db guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setDb(null);
  });

  it("refuses mock mode on the shared Postgres before connecting", async () => {
    setDb(null);
    vi.stubEnv("AI_MODE", "mock");
    vi.stubEnv("DB_DRIVER", "postgres");
    vi.stubEnv("POSTGRES_URL", "postgres://u:p@127.0.0.1:1/none");
    await expect(getDb()).rejects.toThrow(/AI_MODE=mock must not use the shared Postgres/);
  });
});
