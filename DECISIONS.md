# Decisions

Decisions the spec (SPEC.md) leaves open, one line of reasoning each.

- **AI SDK v7 (`ai@7`, `@ai-sdk/react@4`)**: current major; `generateObject` → `generateText` + `Output.object`, `system` → `instructions`, `isStepCount`, stateless `toUIMessageStream`. Mock model is `MockLanguageModelV4`.
- **Supabase provisioned through the Vercel Marketplace** (`vercel integration add supabase`): no separate account or CLI login; env vars sync to Vercel automatically.
- **Tests use PGlite (in-process Postgres) + a local-filesystem storage driver instead of `supabase start`**: Docker isn't installed on the dev machine; the spec's fallback (a second Supabase project) costs a project slot and is slower. Same SQL migrations run on both, and `TEST_DB_DRIVER=postgres` runs the suite against a real Postgres.
- **All DB access goes through `lib/db` with a 3-method `Db` interface (postgres.js live, PGlite in tests)**: one SQL surface, no PostgREST in the hot path, and transactions for status transitions.
- **Migrations applied by `pnpm db:migrate` (own `_migrations` table)** rather than `supabase db push`: no Supabase CLI login needed; equivalent to `supabase db reset` on an empty database.
- **`cacheComponents` turned off**: every page here is per-campaign dynamic data; PPR adds Suspense boundaries for no benefit.
- **Vendored shadcn / AI Elements files are excluded from lint**: they are generated code we don't own.
- **Default models**: `CHAT_MODEL=anthropic/claude-sonnet-5.5`, `SUBAGENT_MODEL=anthropic/claude-haiku-5.5`, `QA_MODEL=google/gemini-3.5-flash-lite` (cheap vision) — all through AI Gateway.
