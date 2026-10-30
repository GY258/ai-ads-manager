import { z } from "zod";

const schema = z
  .object({
    AI_MODE: z.enum(["mock", "live", "replay"]).default("mock"),
    QA_MODE: z.enum(["off", "layout", "full"]).optional(),
    DB_DRIVER: z.enum(["postgres", "pglite"]).default("postgres"),
    STORAGE_DRIVER: z.enum(["supabase", "local"]).default("supabase"),
    PGLITE_DIR: z.string().optional(),
    LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    POSTGRES_URL: z.string().optional(),
    AI_GATEWAY_API_KEY: z.string().optional(),
    VERCEL_OIDC_TOKEN: z.string().optional(),
    FAL_KEY: z.string().optional(),
    FIRECRAWL_API_KEY: z.string().optional(),
    CHAT_MODEL: z.string().default("google/gemini-2.5-flash"),
    SUBAGENT_MODEL: z.string().default("google/gemini-2.5-flash-lite"),
    QA_MODEL: z.string().default("google/gemini-2.5-flash-lite"),
    IMAGE_MODEL: z.string().default("fal-ai/nano-banana/edit"),
    DEMO_USER_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
    MOCK_IMAGE_FAIL: z.string().optional(),
    MOCK_IMAGE_DELAY_MS: z.coerce.number().default(0),
    MOCK_QA_SCRIPT: z.string().optional(),
    APP_URL: z.string().optional(),
  })
  .transform((e) => ({
    ...e,
    QA_MODE: e.QA_MODE ?? (e.AI_MODE === "live" ? "full" : "layout"),
  }));

export type Env = z.infer<typeof schema>;

/** Read fresh on every call so tests can flip flags with process.env. */
export function env(): Env {
  return schema.parse(process.env);
}

export type EnvCheck = { ok: boolean; missing: string[]; mode: Env["AI_MODE"] };

/** Which keys are required depends on mode and drivers. Live mode fails here, not mid-generation. */
export function checkEnv(e: Env = env()): EnvCheck {
  const missing: string[] = [];
  const need = (name: keyof Env) => {
    if (!e[name]) missing.push(name);
  };
  if (e.DB_DRIVER === "postgres") need("POSTGRES_URL");
  if (e.STORAGE_DRIVER === "supabase") {
    need("NEXT_PUBLIC_SUPABASE_URL");
    need("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (e.AI_MODE !== "mock") {
    if (!e.AI_GATEWAY_API_KEY && !e.VERCEL_OIDC_TOKEN) missing.push("AI_GATEWAY_API_KEY");
    if (e.IMAGE_MODEL.startsWith("fal-ai/")) need("FAL_KEY");
    // Firecrawl is optional: the brand adapter falls back to HTML meta tags.
  }
  return { ok: missing.length === 0, missing, mode: e.AI_MODE };
}
