# Test report — AI Ads Manager

2026-10-30 · against SPEC.md › Testing and Build phases. Every checkbox → the test that covers it → result.

Run them: `pnpm test` (unit + integration, PGlite, mock adapters) · `pnpm test:pg` (integration on a real Postgres test DB) ·
`pnpm test:e2e` (build + Playwright on `next start`, mock mode) · `E2E_BASE_URL=<url> npx playwright test` (deployed) ·
`ALLOW_LIVE=1 pnpm smoke:live` (the only paid test).

**Totals:** 111 unit/integration ✅ · 13 e2e locally ✅ · e2e on preview deployment: ✅ 9 passed + 4 skipped (runtime-hook tests; pass locally) · Lighthouse a11y 100 / 100 ✅ · live spend $1.00 of the $2 test budget (25 fal images incl. QA retries, ledger in `spend_log`)

## Unit (no network, no DB) — `tests/unit/`

| Spec item | Test | Result |
| --- | --- | --- |
| Shopify parser: fixture → products + images, strips HTML, 0 images, missing prices | `shopify.test.ts` › Shopify parser (4) | ✅ |
| Pagination stops on empty page and at the 3-page cap | `shopify.test.ts` › pagination (3) | ✅ |
| Image URL normalization: protocol-relative, size suffixes, query strings | `shopify.test.ts` › image URL normalization (6 cases) | ✅ |
| Store detection: JSON vs HTML vs 404 | `shopify.test.ts` › store detection | ✅ |
| Brand kit schema accepts mock synthesis, rejects invalid hex | `brand-kit.test.ts` › brand kit schema | ✅ |
| Contrast picker: white → dark text, black → white text, noisy → scrim | `compose.test.ts` › contrast picker (3) | ✅ |
| Text fitting: short → max size, 6 words ≤ 3 lines, over-long → `too_long` | `compose.test.ts` › text fitting (3) | ✅ |
| `composeAd` exactly 1080×1920 for each layout + fallback template | `compose.test.ts` › composeAd (+ every bundled font) | ✅ |
| Golden snapshots with tolerance | `compose.test.ts` › golden snapshots (mutation-checked: a layout change fails it) | ✅ |
| Copy limits: headline > 6 words, CTA > 3 words rejected | `brand-kit.test.ts` › copy limits; `manage.test.ts` › copy limits | ✅ |
| Status transitions; `ready → queued` throws | `status.test.ts` (5) | ✅ |
| Constraint merging dedupes + appends | `constraints.test.ts`; `repo.test.ts` | ✅ |
| State summary < 400 tokens for 30 ads | `agent-route.test.ts` › state summary | ✅ |
| *(added)* Subagent schemas valid for OpenAI strict mode | `model-schemas.test.ts` (mutation-checked) | ✅ |
| *(added)* Placement-readiness score | `readiness.test.ts` (4) | ✅ |

## Integration (DB + Storage, all adapters mocked) — `tests/integration/`

| Spec item | Test | Result |
| --- | --- | --- |
| `researchStore` on Loopy: 1 brand, N products, images in `product-images/`, `draft`, source map | `research.test.ts` | ✅ |
| `researchStore` twice reuses the brand row | `research.test.ts` | ✅ |
| Non-Shopify → Firecrawl path; empty store → `ok:false` + upload fallback | `research.test.ts` (+ JSON-LD fallback) | ✅ |
| Firecrawl failure → draft kit from HTML meta | `research.test.ts` | ✅ |
| Confirm kit: `confirmed`, campaign with products, user edits win | `agent-route.test.ts` › confirm brand kit | ✅ |
| `planConcepts`: N ads, real `product_image_id`s, ≥ 3 angles | `generation.test.ts` | ✅ |
| `generateAds` × 3: ready, scene + final in Storage, PNG 200, no provider URL stored | `generation.test.ts` | ✅ |
| `MOCK_IMAGE_FAIL=1`: one retry, then `model = 'fallback'` | `generation.test.ts` | ✅ |
| `editAdCopy`: new variant, same scene, zero image calls | `manage.test.ts` | ✅ |
| `regenerateAd` scene: `parent_variant_id`, prompt has the feedback | `manage.test.ts` | ✅ |
| Feedback loop: constraint reaches `planConcepts` prompt | `generation.test.ts`, `manage.test.ts` | ✅ |
| Approve/reject actions update status; canvas query reflects it | `manage.test.ts` | ✅ |

## Pipeline and QA — `tests/integration/pipeline.test.ts`, `manage.test.ts`

| Spec item | Result |
| --- | --- |
| All stages: image × 1, QA × 1, `ready` + `pass` | ✅ |
| Scope `copy` / `editAdCopy`: no image/QA calls, same scene, new row | ✅ |
| `regenerateAd` and canvas server action → identical variant rows | ✅ |
| QA "product fail, then pass": one retry, corrective prompt has issues, `pass` | ✅ |
| QA "product fail twice": hero fallback, mismatched scene never shown | ✅ |
| QA "zone not clean twice": kept as `warn` with a scrim | ✅ |
| Layout QA: low-contrast scene gets scrim ≥ 4.5:1; over-long headline → `copy_too_long` after all layouts | ✅ (`compose.test.ts`) |
| `QA_MODE=layout` skips vision, scene QA `skipped` | ✅ |
| Restore variant: pointer only, no rows, no adapters | ✅ |
| Approving a `warn` ad needs confirmation (e2e) | ✅ (`flow.spec.ts`) |
| Canvas edits write `events`; next state summary mentions it | ✅ |
| *(added)* Interrupted render (> 6 min) is failed so Retry shows | ✅ (mutation-checked) |
| *(added)* Live budget ledger refuses calls past `LIVE_BUDGET_USD` | ✅ (`budget.test.ts`) |

## Agent / route (mock LLM) — `tests/integration/agent-route.test.ts`

| Spec item | Result |
| --- | --- |
| Valid UI message stream for a text reply | ✅ |
| "onboard": `researchStore` → `confirmBrandKit`, stream ends with a pending call | ✅ |
| Resume with `confirmBrandKit` result → `planConcepts` → `generateAds` | ✅ |
| Tool `ok:false` → text reply, not error/500 | ✅ |
| Messages persist and reload in order | ✅ |
| System prompt includes the state summary | ✅ |
| *(added, found live)* Transcript with a dangling tool call still gets a reply | ✅ (mutation-checked) |

## End-to-end (Playwright, mock mode) — `tests/e2e/`

| Spec item | Local | Preview deploy |
| --- | --- | --- |
| Home renders; Loopy URL → campaign screen | ✅ | ✅ |
| Research progress → brand kit; edit color, pick 2, confirm | ✅ | ✅ |
| Skeletons → 6 ready ads, images 1080×1920 | ✅ | ✅ |
| Edit headline: image updates, history shows 2 | ✅ | ✅ |
| Feedback + regenerate → new variant; approve 3; Approved tab = 3 | ✅ | ✅ |
| Reload mid-generation: done ads persist, rest finish | ✅ | skipped (needs runtime test hooks) |
| Image failure → fallback ad with Retry | ✅ | skipped (needs runtime test hooks) |
| Mobile viewport: tabs switch chat ↔ canvas | ✅ | ✅ |
| Failure table: invalid URL · not Shopify + no Firecrawl · brand extraction fails · image fails twice · headline too long · stream drop | ✅ all 6 | ✅ (brand-extraction row skipped remotely: needs hooks) |

## Deployed checks and live runs

| Item | Result |
| --- | --- |
| *(added)* Concept review (HITL): plan → user edits/removes/approves → only approved concepts render | ✅ route test, `generation.test.ts`, e2e helper, live run |
| `/api/health` on the Vercel URL: env, DB, Storage ok | ✅ live and mock deployments |
| e2e suite on the preview deployment (`AI_MODE=mock`) | ✅ 9 passed + 4 skipped (runtime-hook tests; pass locally) |
| `pnpm smoke:live` (research + 1 concept + 1 image + QA) | ✅ fal image, QA pass, `runs/2026-10-30/smoke/` |
| Live research on Loopy (`AI_MODE=replay`), cache saved | ✅ 230 products, mint/navy kit, 1 `model_cache` row, 0 calls on replay |
| Live scene QA: right product passes, wrong reference fails | ✅ (`pnpm qa:live`) |
| Manual live run on Loopy: URL → 3 approved ads, survives reload | ✅ 3 approved in ~6 min |
| Live feedback visibly changes the next generation | ✅ "more premium: darker background, minimal props" → ad regenerated darker with fewer props (`runs/2026-10-30/live/feedback/before-after.png`) |
| Five stores produce approved ads | ✅ Loopy Cases, Allbirds, Ridge, Brooklinen, Tentree — each 1 live ad generated and approved (37–112 s per store) |
| Lighthouse accessibility ≥ 90 on both screens | ✅ 100 / 100 |

## Bugs found by testing (all fixed, with a regression test)

1. postgres.js double-encoded jsonb params (found by `test:pg`).
2. jsonb marker failed `instanceof` across Next bundles → brand colors stored as `{"value": …}` (e2e).
3. Two PGlite instances on one data dir (Next module duplication) → campaign "not found" (e2e).
4. opentype.js throws on Inter's GSUB table → every render failed in production build (e2e).
5. Router navigation aborted the first chat stream (e2e).
6. Live homepage colors/fonts polluted by `<script>` blobs and `&#39;` entities (live research).
7. Stuck renders spinning forever after a killed function (screenshot review).
8. Dangling tool call after a timeout → `MissingToolResultsError` on the next message (live).
9. OpenAI strict mode rejected optional `subhead` (live, reported by Gary).
10. Supabase transaction pooler dropped pipelined replies → multi-ad batches hung until the 300s timeout (live, reproduced with `test:pg`).
11. gpt-5-nano described changes without calling tools → chat model back to gemini-2.5-flash + "act, don't describe" rule (live).
12. Session pooler capped at 15 clients → production page loads failed (`EMAXCONNSESSION`, reported by Gary) → node-postgres Pool on the transaction pooler.
13. Gemini also said "now I'll confirm the brand kit" without calling it → fixed handoffs enforced with `prepareStep` `toolChoice` (`flow.test.ts`).
14. Loopy's live kit turned pink (reported by Gary): a mock-mode preview deployment shared the production Postgres, and the e2e suite run against it re-confirmed Loopy with color 1 = `#FF4FA3`. Fixed the data (back to the scraped `#8FE8B3`), deleted the preview and 23 mock-only campaigns (backup in `runs/brand-audit/`), and added two guards: the app refuses `AI_MODE=mock` on Postgres (`db-guard.test.ts`, mutation-checked), and external e2e runs refuse a deployment whose `/api/health` reports a Postgres DB (`tests/e2e/global-setup.ts`).
15. Home form said "couldn't reach ridgewallet.com" in production (reported by Gary) although the store works: the precheck failed on timeouts/5xx from Vercel's IPs. Now only an unresolvable domain blocks; anything else goes on to research and the reason is logged.
16. Good scenes fell back to the product photo (Ridge, Loopy; reported by Gary): the prompt banned all logos, so QA counted the product's own printed logo as stray text, misread Loopy's ring as "extra" and lighting as a color change; the planner's zone wording also contradicted the layout's. QA now ignores the product's own print, only fails clear hue changes and re-checks parts against the reference; the scene prompt keeps the product's logo, drops planner zone wording and asks for a ~40% hero (`scene-prompt.test.ts`, mutation-checked). Live re-check on the two saved pairs: both now `pass`; swapped references still `fail`. Production image budget raised to $5 (Gary).

## Open

- Firecrawl has no key, so live brand extraction always uses the HTML-meta fallback (works; marked "please check").
- AI Gateway is on the free tier: chat = `google/gemini-2.5-flash`, subagents = `openai/gpt-5-nano`, QA = `google/gemini-2.5-flash-lite`. Better models need a top-up + one env var.
- Production batch size is 1 (`DEFAULT_AD_COUNT=1`) to keep test spend low; 6-ad batches now work (pooler fix) and can be re-enabled.
- `pnpm test:pg` on a shared real DB has one test-isolation failure (repo test counts products other files created); app code is fine.
- The fal bake-off (2–3 models) wasn't run, to stay inside the budget; `fal-ai/nano-banana/edit` at $0.0398/image is the only model tried.
