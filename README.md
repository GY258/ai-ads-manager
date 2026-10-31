# AI Ads Manager

Paste a store URL and get 9:16 ads you can run. A chat agent researches the store, drafts a brand kit for you to check, plans ad concepts for you to approve, and renders the ads. You review, edit and approve them on a canvas, and your feedback carries into the next round.

**Live:** https://ai-ads-manager-eight.vercel.app

## How it works

1. **Research:** `researchStore` reads the Shopify JSON (or Firecrawl / JSON-LD for other stores), copies product photos to Storage, and drafts a brand kit.
2. **Brand kit (you confirm):** the agent pauses on `confirmBrandKit` until you edit or confirm the colors, font, voice and products.
3. **Concepts (you approve):** `planConcepts` writes N concepts (angle, copy, layout, scene prompt), then `reviewConcepts` pauses again so you can edit, remove or approve them. Nothing costs money before this point.
4. **Render:** the image model (fal `nano-banana/edit`) draws only the scene, using the product photo as a reference. A vision QA check confirms the product matches and the text zone is clean, with one retry and then a product-hero fallback. Satori + sharp then draw all the text: three layouts, glyph-measured fitting, and contrast/scrim checks.
5. **Iterate:** edit copy (no image call), regenerate with feedback, approve or reject. Feedback is stored as a brand or campaign constraint and fed into later prompts.

Postgres (Supabase) is the source of truth: chat messages, ads, variants, events and spend. Refreshing loses nothing, a render cut off mid-way is recovered, and every tool returns `ok:false` with a helpful message instead of throwing.

## Stack

Next.js 16 (App Router) · Vercel AI SDK 7 + AI Gateway · Supabase Postgres + Storage · fal · Satori + sharp · Tailwind v4 + shadcn/AI Elements · Vitest + MSW + PGlite · Playwright

## Code map

| Path | What |
| --- | --- |
| `app/api/chat/route.ts` | Agent loop: `streamText` + tools, fixed handoffs via `prepareStep` |
| `lib/agent/` | System prompt + state summary, tools, subagents (brand synthesis, concept planning, copy rewrite) |
| `lib/research/`, `lib/adapters/` | Store research; model, image, Shopify and Firecrawl adapters (mock / live / replay) |
| `lib/pipeline/`, `lib/compose/` | Render pipeline, scene QA, compositor |
| `lib/db/`, `supabase/migrations/` | Repository + schema |
| `components/chat`, `components/canvas` | Chat panel with HITL forms; ad canvas |

## Run it

```bash
pnpm install
cp .env.example .env.local   # AI_MODE=mock works with no keys (PGlite + local storage)
pnpm dev
pnpm test        # unit + integration (112)
pnpm test:e2e    # Playwright on a production build (15)
ALLOW_LIVE=1 pnpm smoke:live   # the only paid test (~$0.04)
```

## Docs

- [SPEC.md](SPEC.md): the build spec
- [DECISIONS.md](DECISIONS.md): choices the spec left open, with reasons
- [TEST-REPORT.md](TEST-REPORT.md): every spec test item → test → result, plus live runs and bugs found
