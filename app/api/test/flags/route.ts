import { env } from "@/lib/env";
import { resetMockQa } from "@/lib/pipeline/scene-qa";

const FLAGS = ["MOCK_IMAGE_FAIL", "MOCK_IMAGE_DELAY_MS", "QA_MODE", "MOCK_QA_SCRIPT", "MOCK_FIRECRAWL_FAIL"] as const;

/** e2e-only: flip mock failure modes at runtime. Disabled unless AI_MODE=mock and ENABLE_TEST_HOOKS=1. */
export async function POST(req: Request) {
  if (env().AI_MODE !== "mock" || process.env.ENABLE_TEST_HOOKS !== "1") return new Response("not found", { status: 404 });
  const body = (await req.json()) as Partial<Record<(typeof FLAGS)[number], string | null>>;
  for (const k of FLAGS) {
    if (!(k in body)) continue;
    if (body[k] == null) delete process.env[k];
    else process.env[k] = String(body[k]);
  }
  resetMockQa();
  return Response.json({ ok: true });
}
