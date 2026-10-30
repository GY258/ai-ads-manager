import { NextResponse } from "next/server";
import { checkEnv } from "@/lib/env";
import { pingDb } from "@/lib/db/ping";
import { checkStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Env + DB + Storage. Never calls a model. */
export async function GET() {
  const envCheck = checkEnv();
  const [db, storage] = envCheck.ok ? await Promise.all([pingDb(), checkStorage()]) : [{ ok: false, error: "skipped: env invalid" }, { ok: false, error: "skipped: env invalid" }];
  const ok = envCheck.ok && db.ok && storage.ok;
  return NextResponse.json(
    {
      status: ok ? "ok" : "error",
      env: envCheck.ok ? { ok: true, mode: envCheck.mode } : { ok: false, mode: envCheck.mode, error: `missing: ${envCheck.missing.join(", ")}` },
      db,
      storage,
    },
    { status: ok ? 200 : 503 },
  );
}
