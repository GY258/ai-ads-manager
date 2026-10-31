/**
 * External runs (E2E_BASE_URL) must not hit a deployment on the shared Postgres: the suite confirms brand kits
 * (e.g. Loopy's color 1 → #FF4FA3) and those rows are reused by the live app. Override with E2E_ALLOW_SHARED_DB=1.
 */
export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL;
  if (!base || process.env.E2E_ALLOW_SHARED_DB === "1") return;
  const token = process.env.VERCEL_OIDC_TOKEN;
  const res = await fetch(new URL("/api/health", base), { headers: token ? { "x-vercel-trusted-oidc-idp-token": token } : {} });
  const health = (await res.json().catch(() => null)) as { db?: { driver?: string } } | null;
  const driver = health?.db?.driver;
  if (driver !== "pglite") {
    throw new Error(
      `Refusing to run e2e against ${base}: its database is ${driver ?? "unknown"}, which may be the shared production DB. ` +
        `Point it at an isolated DB (DB_DRIVER=pglite) or set E2E_ALLOW_SHARED_DB=1 if you are sure.`,
    );
  }
}
