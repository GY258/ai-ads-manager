# Decisions

Decisions the spec (SPEC.md) leaves open, one line of reasoning each.

- **AI SDK v7 (`ai@7`, `@ai-sdk/react@4`)**: current major; `generateObject` → `generateText` + `Output.object`, `system` → `instructions`, `isStepCount`, stateless `toUIMessageStream`. Mock model is `MockLanguageModelV4`.
- **Supabase provisioned through the Vercel Marketplace** (`vercel integration add supabase`): no separate account or CLI login; env vars sync to Vercel automatically.
- **Tests use PGlite (in-process Postgres) + a local-filesystem storage driver instead of `supabase start`**: Docker isn't installed on the dev machine; the spec's fallback (a second Supabase project) costs a project slot and is slower. Same SQL migrations run on both, and `TEST_DB_DRIVER=postgres` runs the suite against a real Postgres.
- **All DB access goes through `lib/db` with a 3-method `Db` interface (postgres.js live, PGlite in tests)**: one SQL surface, no PostgREST in the hot path, and transactions for status transitions.
- **Migrations applied by `pnpm db:migrate` (own `_migrations` table)** rather than `supabase db push`: no Supabase CLI login needed; equivalent to `supabase db reset` on an empty database.
- **`cacheComponents` turned off**: every page here is per-campaign dynamic data; PPR adds Suspense boundaries for no benefit.
- **Vendored shadcn / AI Elements files are excluded from lint**: they are generated code we don't own.
- **Default models are the AI Gateway free-tier ones**: `CHAT_MODEL=google/gemini-2.5-flash`, `SUBAGENT_MODEL` and `QA_MODEL=google/gemini-2.5-flash-lite`. The team has no paid Gateway credits, and newer models (Claude, Gemini 3.x) return 403 on the free tier. After topping up, set `CHAT_MODEL=anthropic/claude-sonnet-5.5` and `SUBAGENT_MODEL=anthropic/claude-haiku-5.5` in Vercel env; no code change.
- **Product upserts are set-based (`jsonb_to_recordset`)**: per-row round trips over the Supabase pooler took over 5 minutes for 230 products; a single statement takes under a second.
- **Campaign is created before research** (`campaigns.brand_id` nullable, `store_url` column): the home form routes to `/c/[id]` immediately, as the spec's UI asks, and the brand row attaches when `researchStore` runs.
- **Ads are addressed by number (#1…) in chat**: tools accept `adId` as a number or uuid. It keeps the state summary small (30 uuids would blow the 400-token budget), and it matches what the user sees on the canvas.
- **Chat stream is teed and drained server-side via `after()`**: tools and transcript persistence finish even if the tab closes mid-stream.
- **Canvas polls `/api/campaigns/[id]`** every 2s while anything renders or the chat is active, else every 15s; Realtime isn't worth it for v1 (the spec allows it).
- **DB singleton lives on `globalThis` and jsonb params use a `Symbol.for` brand instead of `instanceof`**: Next loads lib modules once per bundle (pages, route handlers, actions). Per-module state meant two PGlite copies of one database, and a jsonb marker from one bundle got serialized as `{"value": …}` by another.
- **Ad status transitions allow approved ↔ rejected ↔ draft**: approval is the human's call, and changing your mind shouldn't need a regenerate.
- **Fixture router shared by mock mode and MSW** (`lib/adapters/fixture-http.ts`): the dev server (mock mode) and tests serve the same recorded files. Unknown domains fall through to real fetch in mock mode, which is free and keeps dev usable on any store.
- **Loopy fixture is trimmed** (40 of 230 products, images for 18): the full page was 6.7 MB. The Firecrawl fixture is hand-written in v2 response shape because no Firecrawl key exists yet.
- **Non-Shopify fallback chain is Firecrawl → JSON-LD product pages → ask the user**: JSON-LD is free and covers most WooCommerce/BigCommerce stores when Firecrawl is down or unconfigured.
- **Scripts run with `tsx --conditions=react-server`** so `server-only` modules load outside Next.
