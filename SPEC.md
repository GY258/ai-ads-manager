# AI Ads Manager — Build Spec for Claude Code

Oct 30, 2026 · @gary

## Overview

We are building one slice of an AI ads manager: a marketer pastes a store URL, an agent researches the brand and products, and the marketer ends with 9:16 image ads they can review, iterate on, and approve. Example store: www.loopycases.com (Shopify).

The core decision is **generate the image first, then render the text ourselves**. The image model draws a scene around the real product photo with an empty zone. Our code then draws the headline, CTA, and logo on top with Satori + sharp. This guarantees spelling, legibility, and brand fonts, and it makes copy edits free (no model call).

**How Claude Code should work through this spec**

1. Build in the phase order in *Build phases*. Do not start a phase until the previous phase's acceptance checks pass.
2. Phase 0 is only "the project runs": scaffold, health check, mock chat, tests, deploy. No features.
3. Every external call (LLM, fal, Firecrawl, Shopify) goes through an adapter with a **mock** implementation. Default to `AI_MODE=mock` in dev and tests. Live calls only in the explicit live smoke test.
4. Write the tests listed in *Testing* alongside each phase, not at the end.
5. Keep this spec as the source of truth. If you make a decision the spec doesn't cover, add it to `DECISIONS.md` with one line of reasoning.

**Definition of done:** on the deployed Vercel URL, a user can go from the Loopy Cases URL to at least 3 approved ads, give feedback that visibly changes the next generation, refresh at any point without losing work, and see a helpful message (never a dead end) when a tool fails.

## Architecture

There is exactly one autonomous agent: the main chat agent. Everything else is a tool. A "subagent" is a tool whose `execute` makes one focused `generateObject` call with its own prompt and a Zod schema, then returns typed output. No agent-inside-agent loops.

&#91;embedded content: system architecture · 1 agent, 6 tools, 5 services\]

The chat panel streams to `/api/chat`; the agent calls tools along the bus; each tool talks to one service and writes results to Postgres. The canvas reads ads from Supabase and calls server actions directly, so reviewing ads never needs an LLM call. The lower half shows how every tool step persists: the row is written before the risky call, the file lands in Storage before the row points at it, and any failure ends as a saved `failed` row with a fallback and a retry path, never a lost result.

**Rules that follow from this shape**

- **Postgres is the source of truth, not the chat.** Every tool writes its result to the DB before returning. A refresh, dropped stream, or timeout loses nothing.
- **State injection.** On every request, the route loads a compact state summary (brand kit, campaign, ad counts by status, recent feedback) and puts it in the system prompt. The agent never depends on scrolling back through long message history.
- **Progress streaming.** Long tools write custom data parts (`data-progress`) to the UI message stream, such as "found 42 products" or "rendering ad 3/6".
- **Human in the loop.** `confirmBrandKit` has no `execute`. The client renders a form for that tool call and returns the user's answer with `addToolResult`. The agent resumes from there.

**Server / client split**

| Runs on | What |
| --- | --- |
| Client | Chat UI (`useChat` + AI Elements), tool-result cards, HITL forms, creative canvas, optimistic status changes |
| Server (route handler) | `/api/chat`: agent loop, tools, all API keys |
| Server (server actions) | Canvas actions: approve, reject, edit copy (re-compose only), regenerate with feedback |
| Server (lib) | Adapters for LLM, fal, Firecrawl, Shopify, storage; the compositor; DB repository functions |

No API key or service-role Supabase key ever reaches the client. The client reads ads with the anon key under a single demo user.

## Repo structure and environment

Use pnpm, TypeScript strict, Next.js App Router, Tailwind, Vercel AI SDK, AI Elements, Supabase. Pin the AI SDK major version and check its current docs before writing agent code; tool, HITL, and mock-model APIs changed between v4, v5, and v6.

```
app/
  page.tsx                    # empty state: URL input + example stores
  c/[campaignId]/page.tsx     # chat panel + creative canvas
  api/chat/route.ts           # main agent (streamText + tools)
  api/health/route.ts         # env + DB + storage checks, no model calls
  actions/ads.ts              # server actions: approve, reject, editCopy, regenerate
components/
  chat/                       # AI Elements wrappers, tool cards, BrandKitForm (HITL)
  canvas/                     # AdGrid, AdCard, AdDetail, VariantHistory
lib/
  agent/system-prompt.ts      # prompt + state summary builder
  agent/tools/*.ts            # one file per tool
  adapters/llm.ts             # live (AI Gateway) | mock
  adapters/image-gen.ts       # live (fal) | mock
  adapters/brand-extract.ts   # live (Firecrawl) | mock
  adapters/shopify.ts         # live fetch | fixture
  compose/                    # Satori templates, fonts, contrast, text fitting
  db/                         # typed repository functions (no raw SQL in tools)
  storage.ts                  # upload / copy-from-URL / public URL
  env.ts                      # zod-validated env
supabase/migrations/          # SQL migrations
public/fonts/                 # bundled TTF fonts for Satori
tests/
  fixtures/                   # loopycases products.json, homepage, firecrawl json, sample scene PNG
  unit/  integration/  e2e/
DECISIONS.md
```

| Variable | Used by | Needed in mock mode |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | yes |
| `AI_GATEWAY_API_KEY` | LLM adapter | no |
| `FAL_KEY` | image adapter | no |
| `FIRECRAWL_API_KEY` | brand adapter | no |
| `AI_MODE` | all adapters: `mock` or `live` | yes (`mock`) |
| `CHAT_MODEL`, `SUBAGENT_MODEL`, `IMAGE_MODEL` | adapters | no |
| `DEMO_USER_ID` | DB rows owner | yes |

`lib/env.ts` validates on boot. In `live` mode, a missing service key fails `/api/health` with a clear message instead of failing mid-generation.

## Data model

An `ad` is a concept (angle + copy); an `ad_variant` is one rendered image of it. Regenerating creates a new variant linked to its parent, so iteration history is first-class. All tables carry `id uuid`, `created_at`, `updated_at`, and `user_id` (the demo user).

| Table | Key columns | Notes |
| --- | --- | --- |
| `brands` | `url`, `domain` (unique), `name`, `logo_path`, `colors jsonb`, `fonts jsonb`, `voice`, `value_prop`, `audience`, `tone_words text[]`, `source jsonb`, `status` | `source` records which fields were scraped vs inferred vs user-edited |
| `products` | `brand_id`, `source_id`, `handle`, `title`, `description`, `price`, `currency`, `url`, `tags text[]` | unique (`brand_id`, `source_id`) |
| `product_images` | `product_id`, `source_url`, `storage_path`, `width`, `height`, `position` | copied into Storage before use |
| `campaigns` | `brand_id`, `name`, `goal`, `offer`, `product_ids uuid[]`, `constraints jsonb`, `status` | `constraints` = accumulated rules from feedback |
| `ads` | `campaign_id`, `product_id`, `product_image_id`, `angle`, `headline`, `cta`, `subhead`, `layout`, `scene_prompt`, `status`, `current_variant_id` | the concept |
| `ad_variants` | `ad_id`, `parent_variant_id`, `scene_path`, `final_path`, `prompt`, `model`, `seed`, `layout`, `copy jsonb`, `status`, `error` | `scene_path` = raw model image, `final_path` = composed PNG |
| `feedback` | `campaign_id`, `ad_id` (nullable), `variant_id` (nullable), `text`, `parsed jsonb`, `applied boolean` | campaign-level or ad-level |
| `chat_messages` | `campaign_id`, `message jsonb`, `seq` | persisted UI messages for resume |
| `model_cache` | `key` (hash of adapter + input), `response jsonb`, `created_at` | record/replay for dev, see Testing |

**Statuses** (Postgres enums, transitions enforced in `lib/db`):

- `brands.status`: `researching` → `draft` → `confirmed`, or `failed`
- `ads.status`: `draft` → `approved` or `rejected`; `rejected` → `draft` on regenerate
- `ad_variants.status`: `queued` → `generating_scene` → `composing` → `ready`, or `failed`

**QA and events.** `ad_variants` also carries `qa jsonb` and `qa_status` (`pass`, `warn`, `fail`, `skipped`). Add an `events` table (`campaign_id`, `type`, `payload jsonb`, `created_at`) for canvas actions the agent should know about, and a `tool_runs` table (`tool`, `campaign_id`, `input`, `output`, `error`, `duration_ms`, `model_calls`) logged by every tool step.

**Storage buckets** (public read, server-only write):

- `brand-assets/{brand_id}/logo.{ext}`
- `product-images/{brand_id}/{product_id}/{position}.{ext}`
- `ad-scenes/{ad_id}/{variant_id}.png` (raw model output, copied from the fal URL immediately)
- `ad-finals/{ad_id}/{variant_id}.png` (1080×1920 composed ad)

Never store a fal URL or a Shopify CDN URL as the only copy. `source_url` is kept for provenance; `storage_path` is what the app serves.

## Main agent

The main agent is a single `streamText` call in `app/api/chat/route.ts` with all tools registered and a step limit of 8 per request. It decides the next action; tools do the work.

**System prompt rules** (in `lib/agent/system-prompt.ts`):

1. Role: a performance-marketing creative strategist working for the user. Short, concrete replies; the canvas shows the ads, so never describe images at length in chat.
2. Flow: URL → `researchStore` → `confirmBrandKit` → `planConcepts` → `generateAds` → review loop. Never generate ads before the brand kit is confirmed.
3. Never invent a product. Every ad must reference a `product_image_id` from the DB.
4. Turn vague feedback into specific changes before regenerating ("more premium" → darker palette, minimal props, serif headline). Say in one line what will change.
5. Copy limits: headline ≤ 6 words, subhead ≤ 12 words, CTA ≤ 3 words.
6. When a tool returns `ok: false`, explain the problem in one sentence and offer the fallback the tool suggests. Never stop at the error.

**State injection.** Before each request, `buildStateSummary(campaignId)` returns about 300 tokens appended to the system prompt:

```
Brand: Loopy Cases (confirmed). Voice: playful, bold. Colors: #FF4FA3, #111111.
Campaign goal: holiday gifting, offer: none.
Products selected: 3 (ids...).
Ads: 6 total; 2 approved, 1 rejected, 3 draft.
Open constraints: avoid busy backgrounds; prefer lifestyle shots.
Latest feedback: "ad 3 headline too generic".
```

**Tools registered on the agent**

| Tool | Kind | Model calls |
| --- | --- | --- |
| `researchStore` | server | 1 subagent call (brand synthesis) |
| `confirmBrandKit` | HITL (no `execute`) | 0 |
| `planConcepts` | server, subagent | 1 |
| `generateAds` | server | 1 image call per ad |
| `regenerateAd` | server | 1 image call (+ 1 small LLM call if copy changes) |
| `editAdCopy` | server | 0 (re-compose only) |
| `setAdStatus` | server | 0 |
| `recordFeedback` | server | 0 (agent passes parsed constraints in the input) |

Use a capable model for `CHAT_MODEL` and a cheaper, fast model for `SUBAGENT_MODEL`. Both go through the AI Gateway.

## Tool specs

Every server tool returns `{ ok: true, ... }` or `{ ok: false, error, fallback }` and never throws to the agent. Tools that render images (`generateAds`, `regenerateAd`, `editAdCopy`) are thin wrappers over `renderVariant`; see *Shared render pipeline and QA*. Each tool validates input with Zod and writes to the DB before returning.

### researchStore({ url })

1. Normalize the URL to its origin. If a `brands` row with that domain exists and is `confirmed`, return it (no re-scrape) unless `force: true`.
2. Insert `brands` row with status `researching`. Stream progress.
3. **Products (scrape):** GET `{origin}/products.json?limit=250&page=n` until empty or 3 pages (max 750 products). Parse title, handle, description (strip HTML), price, tags, images. If the response is not JSON or 404 → not Shopify → fallback: Firecrawl scrape of the homepage and top product links.
4. **Brand signals (scrape):** Firecrawl branding extraction on the homepage for logo, colors, fonts, tagline. On failure: use `og:image`, `theme-color`, and favicon from the homepage HTML.
5. **Brand synthesis (infer):** one `generateObject` call with the homepage text + 10 product titles/descriptions → `{ name, voice, value_prop, audience, tone_words[], suggested_hero_product_ids[] }`.
6. Copy the logo and the first 2 images of each suggested hero product into Storage. Other images are copied lazily when selected.
7. Set status `draft`. Return a summary: counts, the kit, and the `source` map of scraped vs inferred fields.

If no products are found at all, return `ok: false` with `fallback: "ask_for_product_urls_or_upload"`.

### confirmBrandKit({ brandId }) — HITL

No `execute`. The client renders `BrandKitForm` inline in the chat with: logo, color swatches (editable hex), font, voice and audience (editable text), a product picker (grid of product photos, pick 1–3, hero suggestions preselected), campaign goal (select + free text), optional offer/discount, and "things to avoid". Submitting calls `addToolResult` with the edited values and a server action persists them, sets `brands.status = confirmed`, and creates the `campaigns` row. Inferred fields are visually marked so the user knows what to check.

### planConcepts({ campaignId, count = 6 })

One `generateObject` call (subagent). Input: brand kit, selected products (title, description, image dimensions), campaign goal/offer, all `campaigns.constraints`, and recent `feedback`. Output, per concept:

```ts
{ angle: 'social_proof' | 'gift' | 'problem_solution' | 'lifestyle' | 'offer' | 'feature',
  product_image_id: string, headline: string, subhead?: string, cta: string,
  layout: 'top_headline' | 'bottom_card' | 'split',
  scene_prompt: string }   // describes the scene, NO text, names the empty zone
```

Rules: at least 3 distinct angles across the set; spread across selected products; each `scene_prompt` must state which area stays empty for text, matching `layout`. Insert `ads` rows as `draft`.

### generateAds({ campaignId, adIds? })

For each ad (parallel, concurrency 3), call renderVariant with all stages:

1. Insert `ad_variants` row `queued` → `generating_scene`.
2. Call the image adapter with the product image's Storage URL as reference, the `scene_prompt`, aspect 9:16, and a fixed negative instruction: no text, no letters, no logos, keep the product identical.
3. Immediately download the result and upload to `ad-scenes/`. Never keep only the fal URL.
4. Status `composing` → run `composeAd` (next section) → upload to `ad-finals/` → status `ready`, set `ads.current_variant_id`.
5. On image failure: retry once; if it fails again, fall back to the **product hero template** (real product photo on a brand-color background, no generation) and mark the variant `model: 'fallback'`. The user still gets an ad.

Keep a single request under the Vercel function limit: generate at most 6 per call; the agent calls again for more.

### regenerateAd({ adId, feedback, scope })

`scope` is `scene`, `copy`, or `both`. Save `feedback` with `parsed` constraints. Copy-only changes re-run the copy step (small LLM call) and `composeAd` without a new image. Scene changes create a new variant with `parent_variant_id` and the old prompt plus the feedback delta.

### editAdCopy({ adId, headline?, subhead?, cta?, layout? })

Direct user edit. Validates length limits, re-composes from the existing `scene_path`, creates a new variant. Zero model calls. Also exposed as a server action for the canvas.

### setAdStatus({ adId, status }) and recordFeedback({ campaignId, adId?, text, constraints\[\] })

Plain DB writes. `recordFeedback` merges campaign-level constraints into `campaigns.constraints` so every future `planConcepts` and `regenerateAd` call sees them. This is the "feedback changes the next generation" loop.

## Text rendering pipeline (composeAd)

The image model never draws text. `composeAd` takes the scene PNG and the copy and produces a 1080×1920 PNG with the headline, subhead, CTA button, and logo, using Satori (JSX → SVG) and sharp (SVG → PNG, composite onto the scene). It runs in the Node runtime and makes no model calls, so it is fully unit-testable.

**Steps**

1. Load the scene and resize/cover-crop to exactly 1080×1920 with sharp.
2. Pick the layout's text zone: `top_headline` = top 32%, `bottom_card` = bottom 30%, `split` = top 22% headline + bottom 14% CTA.
3. **Contrast:** sample the zone's mean luminance with `sharp().extract().stats()`. Choose white or near-black text; if the zone is busy (high standard deviation), add a gradient scrim or a solid card in the brand color at 85% opacity.
4. **Text fitting:** start the headline at 112px and step down to 64px until it fits in at most 3 lines (measure with the font's metrics via Satori layout). Below 64px, return an error so the agent shortens the copy instead of rendering tiny text.
5. Render the overlay with Satori: headline, optional subhead, CTA pill (brand primary color, contrast-checked label, min 88px tall), logo in a corner, all inside 64px safe margins (keep the bottom 120px free of key text for system UI on interstitials).
6. Composite overlay onto the scene with sharp, export PNG, upload to `ad-finals/`.

**Fonts.** Satori needs TTF/OTF/WOFF (not WOFF2). Bundle about 8 Google Fonts in `public/fonts/` covering sans, serif, rounded, and display. Map the brand's detected font to the closest bundled one; the user can change it in the brand kit. Never fetch fonts at render time.

**Templates.** Three layouts are enough for v1, each a pure function `(copy, kit, contrast) => JSX`. The **product hero** fallback template uses the real product photo (background removed if available, otherwise placed on a rounded card) on a brand-color background; it is used when image generation fails.

**Quality checks.** Layout QA runs inside `composeAd`; scene QA runs before it. Both are specified in *Shared render pipeline and QA*.

## Shared render pipeline and QA

`generateAds`, `regenerateAd`, and `editAdCopy` never call each other. All three call one library function, `renderVariant(adId, options)` in `lib/pipeline/render-variant.ts`, so persistence, retries, and QA exist in exactly one place. The canvas server actions call the same function, so a click and a chat message produce identical results.

&#91;embedded content: renderVariant pipeline · 5 stages, scene QA and layout QA branches\]

Every stage follows the row-first lifecycle from the Architecture diagram. Nothing is overwritten: each run creates a new `ad_variants` row, and "undo" just moves `ads.current_variant_id` back to an older variant.

| Caller | Stages run | Model calls | What is saved |
| --- | --- | --- | --- |
| `generateAds` | all 5, per new ad | 1 image + 1 vision QA per ad | new variants; `ads.current_variant_id` |
| `regenerateAd` scope `scene` | all 5, prompt = parent prompt + feedback delta | 1 image + 1 vision QA | new variant with `parent_variant_id`; `feedback` row |
| `regenerateAd` scope `copy` | 1, 4, 5, reusing parent `scene_path` | 1 small LLM call to rewrite copy | new variant, same scene; `feedback` row |
| `regenerateAd` scope `both` | all 5 | 1 image + 1 vision QA + 1 small LLM | as above |
| `editAdCopy` (chat or canvas) | 1, 4, 5 with the user's exact text | 0 | new variant, same scene |
| `setAdStatus` / restore variant | none | 0 | `ads.status` or `ads.current_variant_id` |

**Scene QA** (`lib/pipeline/scene-qa.ts`, one cheap vision call via `QA_MODEL`). Input: the scene PNG, the reference product photo, the layout's text zone. Output:

```ts
{ product_match: 'pass' | 'warn' | 'fail',  // same shape, color, print as the reference
  text_zone_clean: boolean,                   // the empty zone is really empty
  stray_text: boolean,                        // the model drew letters or fake logos
  extra_products: boolean,
  issues: string[] }
```

Outcomes: all clear → `pass`. Minor issues (slightly busy zone) → `warn`, continue with a badge. `product_match: fail`, `stray_text`, or an unclean zone → one retry with a corrective prompt built from `issues`. A second fail on product match → hero fallback template; a second fail on zone or text only → keep it as `warn` (the compositor's scrim usually covers it).

**Layout QA** (inside `composeAd`, no model): output is exactly 1080×1920; headline ≥ 64px; text contrast ≥ 4.5:1 against the sampled zone; CTA and logo inside the safe margins. On failure it tries, in order: add a scrim, switch to the other layouts, then return `copy_too_long` so the agent proposes shorter copy.

**Storage.** QA results go in `ad_variants.qa` (jsonb) and `ad_variants.qa_status` (`pass`, `warn`, `fail`, `skipped`). The canvas shows them as badges. Approving a `warn` ad asks for one confirmation; approval is always the human's call.

**Agent awareness.** Canvas actions write an `events` row ("user edited ad 3 headline"), and the state summary includes the last 5 events, so the agent knows what happened outside the chat.

**Config.** `QA_MODE=off | layout | full` (default `full` in live, `layout` while iterating on UI) and `QA_MODEL`. In mock mode the QA adapter is scripted like the others.

## UI

Two screens. Chat steers; the canvas is where ads are judged.

**Home (empty state).** One URL field, a short line on what happens next ("We'll read your store, draft a brand kit for you to check, then make 9:16 ads from your real product photos"), three example store chips (Loopy Cases first), and a list of past brands if any exist. Submitting creates the campaign and routes to `/c/[campaignId]` with the URL as the first message.

**Campaign screen.** Chat panel on the left (about 420px), creative canvas on the right. On mobile, tabs switch between them.

- **Chat:** AI Elements `Conversation`, `Message`, `Tool`, and `Loader`. Each tool call renders as a card: research shows a progress list then a brand kit summary; `confirmBrandKit` shows the editable form; generation shows a strip of thumbnails that fill in as variants become `ready`.
- **Canvas:** grid of 9:16 cards with filter tabs (All, Draft, Approved, Rejected). Each card shows a skeleton while `generating_scene`/`composing`, the final image when `ready`, and an error state with a retry button when `failed`. Hover actions: approve, reject, open.
- **Ad detail drawer:** full-size image, editable headline/subhead/CTA and layout picker (instant re-compose), a feedback box ("tell the agent what to change"), and variant history with the ability to restore an older variant.
- **Brand kit panel:** a collapsible header strip showing logo, colors, and voice, with an edit button.

**Failure states (never a dead end):**

| Failure | What the user sees |
| --- | --- |
| URL unreachable or invalid | inline error on the URL field, with an example of a valid URL |
| Not a Shopify store, Firecrawl also fails | agent asks for product page URLs or a photo upload |
| Brand extraction fails | kit is pre-filled from HTML meta tags; fields marked "please check" |
| Image generation fails twice | product hero fallback ad, labeled as fallback, with a retry button |
| Headline too long to fit | agent proposes 3 shorter options |
| Stream drops / page refresh | messages and ads reload from Postgres; in-flight variants keep updating |

## Testing

The whole app must be testable end to end with **zero paid model calls**. Every external dependency sits behind an adapter with a mock; only one opt-in live smoke test spends money, and it is capped.

### How we avoid model usage

- **`AI_MODE=mock` (default in dev and CI).** `adapters/llm.ts` returns a mock language model from `ai/test` (use the mock model class and `simulateReadableStream` for the installed AI SDK version). Mocks are scripted: given a scenario name, they emit a fixed sequence of text and tool calls.
- **Image mock.** `adapters/image-gen.ts` returns a fixture 1080×1920 scene PNG from `tests/fixtures/` (served by a local route or uploaded to Storage), after a configurable delay to exercise loading states. A `MOCK_IMAGE_FAIL=1` flag makes it fail, for fallback tests.
- **Research fixtures.** Record once: `pnpm fixtures:record https://www.loopycases.com` saves `products.json` pages, homepage HTML, and the Firecrawl response to `tests/fixtures/loopycases/`. Tests use MSW to serve them. Add a second fixture for a non-Shopify site and an empty store.
- **Record/replay for dev.** In `AI_MODE=replay`, adapters look up `model_cache` by a hash of the input; on a miss they call live once and store the result. Iterating on UI then costs nothing after the first run.
- **Live smoke test (opt-in).** `pnpm smoke:live` runs one research + 1 concept + 1 image on Loopy Cases. It refuses to run without `ALLOW_LIVE=1` and stops after 1 image call.

### Test stack

Vitest for unit and integration, local Supabase (`supabase start`, Docker) for anything touching the DB or Storage, MSW for HTTP fixtures, Playwright for e2e against `next start` in mock mode. If Docker is unavailable, use a separate Supabase test project and reset it with a script; never run tests against the demo project.

### Unit tests (no network, no DB)

- [ ] Shopify parser: maps fixture `products.json` to products + images; strips HTML from descriptions; handles products with 0 images and missing prices.
- [ ] Pagination stops on an empty page and at the 3-page cap.
- [ ] Shopify image URL normalization: protocol-relative URLs, size suffixes, query strings.
- [ ] Store detection: JSON vs HTML vs 404 responses choose the right path.
- [ ] Brand kit Zod schema accepts the mock synthesis output and rejects invalid hex colors.
- [ ] Contrast picker: a white fixture zone yields dark text; a black zone yields white text; a noisy zone adds a scrim.
- [ ] Text fitting: short headline renders at max size; a 6-word headline fits in ≤3 lines; an over-long headline returns `too_long`.
- [ ] `composeAd` returns a PNG of exactly 1080×1920 for each layout and the fallback template (check with `sharp().metadata()`).
- [ ] Snapshot test: pixel-compare composed fixture ads against golden PNGs with a small tolerance, so layout regressions show up.
- [ ] Copy limits: headline > 6 words, CTA > 3 words are rejected by `editAdCopy` validation.
- [ ] Status transitions: allowed transitions pass; e.g. `ready` → `queued` throws.
- [ ] Constraint merging: new feedback constraints dedupe and append to `campaigns.constraints`.
- [ ] State summary builder stays under 400 tokens for a campaign with 30 ads.

### Integration tests (local Supabase, all adapters mocked)

- [ ] `researchStore` on the Loopy fixture creates 1 brand, N products, images copied to `product-images/`, status `draft`, and a correct `source` map.
- [ ] `researchStore` twice on the same domain reuses the brand row (no duplicates).
- [ ] Non-Shopify fixture uses the Firecrawl path; empty-store fixture returns `ok: false` with the upload fallback.
- [ ] Firecrawl mock failure still produces a draft kit from HTML meta tags.
- [ ] Confirming the kit sets `confirmed`, creates a campaign with selected products, and stores user edits over inferred values.
- [ ] `planConcepts` inserts the requested number of `ads`, all referencing existing `product_image_id`s, with ≥3 distinct angles.
- [ ] `generateAds` for 3 ads: each ends `ready`, `scene_path` and `final_path` exist in Storage, the public URL returns HTTP 200 with `image/png`, and no row contains a fal URL as its only path.
- [ ] `MOCK_IMAGE_FAIL=1`: retry happens once, then the variant is `ready` with `model = 'fallback'`.
- [ ] `editAdCopy` creates a new variant, reuses the same `scene_path`, and makes zero image-adapter calls (assert with a spy).
- [ ] `regenerateAd` with scope `scene` creates a variant with `parent_variant_id` set and a prompt containing the feedback.
- [ ] Feedback loop: record "avoid busy backgrounds", then `planConcepts` receives it in its input (assert on the mock's captured prompt).
- [ ] Approve/reject server actions update status and the canvas query reflects it.

### Pipeline and QA tests (local Supabase, mocked adapters)

- [ ] `renderVariant` with all stages: image adapter called once, QA adapter called once, variant ends `ready` with `qa_status = pass`.
- [ ] Scope `copy` and `editAdCopy`: image and QA adapters are never called (spies), `scene_path` equals the parent's, a new variant row exists.
- [ ] `regenerateAd` and the canvas server action produce identical variant rows for the same input.
- [ ] Scripted QA "product fail, then pass": exactly one retry, corrective prompt contains the QA `issues`, final `qa_status = pass`.
- [ ] Scripted QA "product fail twice": variant uses the hero fallback (`model = 'fallback'`), never shows the mismatched scene.
- [ ] Scripted QA "zone not clean twice": variant is kept with `qa_status = warn` and a scrim.
- [ ] Layout QA: a low-contrast fixture scene gets a scrim and reaches contrast ≥ 4.5:1; an over-long headline returns `copy_too_long` after trying all layouts.
- [ ] `QA_MODE=layout` skips the vision call and sets `qa_status = skipped` for scene QA.
- [ ] Restore variant moves `current_variant_id` without creating rows or calling any adapter.
- [ ] Approving a `warn` ad requires confirmation in the UI (e2e); approving a `pass` ad does not.
- [ ] Canvas edits write an `events` row, and the next state summary mentions it.

### Agent / route tests (mock LLM, scripted)

- [ ] `/api/chat` streams a valid UI message stream for a plain text reply.
- [ ] Scripted scenario "onboard": the agent calls `researchStore`, then `confirmBrandKit`, and the stream ends with a pending tool call (no execute) — the pause works.
- [ ] Resuming with a tool result for `confirmBrandKit` continues to `planConcepts` and `generateAds`.
- [ ] A tool returning `ok: false` results in a text reply, not a thrown error or 500.
- [ ] Messages persist to `chat_messages` and reload in order.
- [ ] The system prompt includes the state summary for the campaign.

### End-to-end (Playwright, mock mode)

- [ ] Home empty state renders; submitting the Loopy URL navigates to the campaign screen.
- [ ] Research progress appears, then the brand kit form; editing a color and picking 2 products then confirming works.
- [ ] Canvas shows skeletons, then 6 ready ads; images load (natural size 1080×1920).
- [ ] Edit a headline in the drawer: the image updates and the variant history shows 2 entries.
- [ ] Give feedback and regenerate: a new variant appears; approve 3 ads; the Approved tab shows 3.
- [ ] Reload mid-generation: completed ads persist and remaining ones finish.
- [ ] Image failure mode shows a fallback ad with a retry button, not a broken card.
- [ ] Mobile viewport: tabs switch between chat and canvas.

### Deployed checks

- [ ] `/api/health` on the Vercel URL returns `ok` for env, DB, and Storage.
- [ ] Run the e2e suite against the preview deployment with `AI_MODE=mock`, then do one manual live run on Loopy Cases.

## Build phases

Each phase ends green: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and the phase's acceptance checks. Commit at the end of every phase.

1. **Phase 0 — the project runs.** Scaffold Next.js (App Router, TS strict, Tailwind), install AI SDK + AI Elements, Supabase client, Vitest, Playwright, MSW. Add `lib/env.ts`, the adapter interfaces with mock implementations only, `/api/health`, and a `/api/chat` route that streams from the mock model. Home page with the URL field (non-functional). Deploy to Vercel.
   - Acceptance: `pnpm dev` loads the home page; the chat route streams a mock reply in the browser; `/api/health` returns `ok` locally and on the Vercel URL; one unit test, one integration test (DB ping), and one Playwright test pass.
2. **Phase 1 — data layer.** Migrations for all tables, enums, and buckets; `lib/db` repository functions; `lib/storage.ts` with `uploadFromUrl` and `publicUrl`; seed script for the demo user.
   - Acceptance: `supabase db reset` applies cleanly; status-transition and storage round-trip tests pass.
3. **Phase 2 — research.** Record Loopy fixtures, Shopify adapter, brand-extract adapter, synthesis subagent (mock), `researchStore` tool.
   - Acceptance: research unit + integration tests pass; one live run on Loopy Cases (`AI_MODE=replay`) produces a sensible kit and the cache is saved.
4. **Phase 3 — agent + HITL.** System prompt, state summary, tool registration, chat UI with tool cards, `BrandKitForm`, message persistence.
   - Acceptance: agent route tests pass; the e2e flow reaches a confirmed brand kit in mock mode.
5. **Phase 4 — generation.** `planConcepts`, `composeAd` with 3 layouts + fallback, image adapter (live fal behind the interface), `generateAds`.
   - Acceptance: compose unit tests + golden snapshots pass; `generateAds` integration test passes; one live image on Loopy Cases looks right (product recognizable, text legible), passes scene QA, and a deliberately wrong reference photo fails it.
6. **Phase 5 — manage.** Canvas, ad drawer, server actions, `editAdCopy`, `regenerateAd`, `setAdStatus`, `recordFeedback`, Realtime or polling updates.
   - Acceptance: full e2e suite passes in mock mode.
7. **Phase 6 — polish and the open-ended feature.** Failure states from the UI table, empty state copy, mobile layout, optional fidelity check, open-ended feature.
   - Acceptance: every row in the failure table has a passing test; Lighthouse accessibility ≥ 90 on both screens.
8. **Phase 7 — ship.** Production env vars on Vercel, `pnpm smoke:live` once, five-store manual run for the Loom.
   - Acceptance: deployed checks pass; five stores produce approved ads.

## Open decisions and things to verify

- [ ] **fal model.** Bake off 2–3 reference-image edit models on 3 Loopy products in Phase 4 (judge product fidelity and empty-zone obedience). Record the choice and cost per image in `DECISIONS.md`.
- [ ] **AI SDK version.** Confirm the current major version's APIs for tools without `execute`, `addToolResult`, data parts, and the mock model before Phase 0.
- [ ] **Vercel function duration** on the target plan; if 6 parallel images exceed it, switch `generateAds` to fal's queue + webhook.
- [ ] **Background removal** for the product hero fallback: use a fal background-removal model or skip it and use a card layout.
- [ ] **Realtime vs polling** for the canvas; polling every 2s while any variant is in flight is acceptable for v1.
- [ ] **Open-ended feature.** Pick one: a placement-readiness score per ad (text size at phone scale, contrast, product visibility), a structured A/B set that varies one dimension at a time, or brand-drift warnings before approval.
- [ ] **Auth.** Single demo user for v1; note the RLS policies needed to add real auth later.
