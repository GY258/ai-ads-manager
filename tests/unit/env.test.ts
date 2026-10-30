import { describe, expect, it } from "vitest";
import { checkEnv, env } from "@/lib/env";

describe("env", () => {
  it("defaults to mock mode and needs no model keys", () => {
    const e = { ...env(), AI_MODE: "mock" as const, DB_DRIVER: "pglite" as const, STORAGE_DRIVER: "local" as const };
    expect(checkEnv(e)).toEqual({ ok: true, missing: [], mode: "mock" });
  });
  it("live mode reports missing service keys instead of failing later", () => {
    const e = { ...env(), AI_MODE: "live" as const, DB_DRIVER: "pglite" as const, STORAGE_DRIVER: "local" as const, AI_GATEWAY_API_KEY: undefined, VERCEL_OIDC_TOKEN: undefined, FAL_KEY: undefined };
    expect(checkEnv(e).missing).toEqual(["AI_GATEWAY_API_KEY", "FAL_KEY"]);
  });
});
