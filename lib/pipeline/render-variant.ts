import { env } from "@/lib/env";
import * as repo from "@/lib/db/repo";
import type { Copy, Layout, QaStatus, Variant } from "@/lib/db/types";
import { imageGenerator, type SceneResult } from "@/lib/adapters/image-gen";
import { composeAd, normalizeScene } from "@/lib/compose/compose";
import { buildHeroScene } from "@/lib/compose/scene-builder";
import { closestFont } from "@/lib/compose/font-catalog";
import { copyProductImage } from "@/lib/research/copy-images";
import { download, publicUrl, upload } from "@/lib/storage";
import { buildScenePrompt } from "./scene-prompt";
import { classify, runSceneQa, type SceneQa } from "./scene-qa";
import type { Progress } from "@/lib/agent/tools/types";

export type RenderOptions = {
  /** full: new scene (stages 1-5). compose: reuse the parent's scene (stages 1, 4, 5) — zero image/QA calls. */
  mode: "full" | "compose";
  parentVariantId?: string | null;
  copy?: Copy;
  layout?: Layout;
  /** Feedback delta appended to the parent prompt for scene changes. */
  delta?: string | null;
  progress?: Progress;
};

export type RenderResult =
  | { ok: true; variant: Variant; adNumber: number; fallback: boolean; qaStatus: QaStatus; modelCalls: number }
  | { ok: false; variant: Variant | null; adNumber: number; reason: "copy_too_long" | "error"; error: string; attempts?: string[]; modelCalls: number };

const RANK: Record<QaStatus, number> = { pass: 0, skipped: 0, warn: 1, fail: 2 };
const worst = (...s: QaStatus[]) => s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "pass" as QaStatus);

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * The one render pipeline. generateAds, regenerateAd, editAdCopy and the canvas actions all call this,
 * so persistence, retries and QA live in exactly one place. Row first, file before pointer, failures saved.
 */
export async function renderVariant(adId: string, opts: RenderOptions): Promise<RenderResult> {
  const ad = await repo.getAd(adId);
  if (!ad) throw new Error(`ad ${adId} not found`);
  const adNumber = await repo.adNumber(ad);
  const campaign = (await repo.getCampaign(ad.campaign_id))!;
  const brand = campaign.brand_id ? await repo.getBrand(campaign.brand_id) : null;
  if (!brand) throw new Error("campaign has no brand");
  const parent = opts.parentVariantId !== undefined ? (opts.parentVariantId ? await repo.getVariant(opts.parentVariantId) : null) : ad.current_variant_id ? await repo.getVariant(ad.current_variant_id) : null;
  const copy: Copy = opts.copy ?? { headline: ad.headline, subhead: ad.subhead, cta: ad.cta };
  const layout: Layout = opts.layout ?? ad.layout;
  const e = env();
  let modelCalls = 0;

  if (opts.mode === "compose" && !parent?.scene_path) throw new Error("no existing scene to re-compose");
  const prompt =
    opts.mode === "compose"
      ? parent!.prompt
      : buildScenePrompt({ scenePrompt: ad.scene_prompt, layout, brandColors: brand.colors, constraints: campaign.constraints, delta: opts.delta });

  // 1. Row first.
  let variant = await repo.insertVariant({ ad_id: ad.id, parent_variant_id: parent?.id ?? null, layout, copy, prompt, scene_path: opts.mode === "compose" ? parent!.scene_path : null, model: opts.mode === "compose" ? parent!.model : null });
  const t0 = Date.now();
  const say = (m: string) => {
    console.log(`[render ${variant.id.slice(0, 8)} +${Date.now() - t0}ms] ${m}`);
    opts.progress?.(m, { adId: ad.id, variantId: variant.id });
  };
  say(`start mode=${opts.mode} ad #${adNumber}`);

  try {
    let fallback = opts.mode === "compose" ? parent!.model === "fallback" : false;
    let sceneQa: (SceneQa & { attempts?: number; fallback_reason?: string }) | { skipped: true } | { fallback_reason: string } = { skipped: true };
    let sceneStatus: QaStatus = "skipped";
    let dirtyZone = false;

    if (opts.mode === "full") {
      variant = await repo.updateVariant(variant.id, {}, "generating_scene");
      const img = await repo.getProductImage(ad.product_image_id);
      if (!img) throw new Error("product image missing");
      const stored = await copyProductImage(brand.id, img);
      say("reference copied");
      const reference = await download(stored.storage_path!);
      say(`reference downloaded (${reference.byteLength} bytes)`);
      const referenceType = stored.storage_path!.endsWith(".png") ? "image/png" : stored.storage_path!.endsWith(".webp") ? "image/webp" : "image/jpeg";
      const scenePath = `ad-scenes/${ad.id}/${variant.id}.png` as const;

      // 2. Scene: image call, retried once on error.
      const generate = async (p: string): Promise<{ bytes: Buffer; res: SceneResult } | null> => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            say(`image call attempt ${attempt}`);
            const res = await imageGenerator().generate({ prompt: p, referenceUrl: publicUrl(stored.storage_path!), referenceBytes: reference });
            // 3. Download immediately; the provider URL is never our only copy.
            const raw = res.bytes ?? (await fetchBytes(res.url!));
            return { bytes: await normalizeScene(raw), res };
          } catch (err) {
            say(`Image model error on ad #${adNumber} (attempt ${attempt}): ${(err as Error).message.slice(0, 120)}`);
          }
        }
        return null;
      };

      let scene = await generate(prompt!);
      let currentPrompt = prompt!;
      if (scene && e.QA_MODE === "full") {
        say(`Checking ad #${adNumber} scene`);
        let check = await runSceneQa({ scene: scene.bytes, reference, referenceType, layout });
        modelCalls += check.modelCalls;
        let outcome = classify(check.qa);
        let attempts = 1;
        if (outcome === "retry") {
          await upload(`ad-scenes/${ad.id}/${variant.id}-attempt1.png`, scene.bytes, "image/png");
          currentPrompt = buildScenePrompt({ scenePrompt: ad.scene_prompt, layout, brandColors: brand.colors, constraints: campaign.constraints, delta: opts.delta, corrective: check.qa.issues });
          say(`Ad #${adNumber}: retrying scene (${check.qa.issues.join("; ").slice(0, 100)})`);
          const retry = await generate(currentPrompt);
          if (retry) {
            scene = retry;
            check = await runSceneQa({ scene: retry.bytes, reference, referenceType, layout });
            modelCalls += check.modelCalls;
            outcome = classify(check.qa);
            attempts = 2;
          }
          if (outcome === "retry") {
            if (check.qa.product_match === "fail" || !retry) {
              // Never show a mismatched product: hero fallback instead.
              scene = null;
              sceneQa = { ...check.qa, attempts, fallback_reason: retry ? "product did not match the reference twice" : "product did not match and the retry image failed" };
            } else {
              outcome = "warn"; // zone/text only: keep it, the compositor's scrim covers it
              dirtyZone = true;
            }
          }
        }
        if (scene) {
          sceneQa = { ...check.qa, attempts };
          sceneStatus = outcome === "pass" ? "pass" : "warn";
        }
      }

      if (scene) {
        await upload(scenePath, scene.bytes, "image/png");
        variant = await repo.updateVariant(variant.id, { scene_path: scenePath, model: scene.res.model, seed: scene.res.seed != null ? String(scene.res.seed) : null, prompt: currentPrompt });
      } else {
        // 5. Fallback: real product photo on a brand-color background. The user still gets an ad.
        fallback = true;
        if (!("fallback_reason" in sceneQa)) sceneQa = { fallback_reason: "image generation failed twice" };
        say(`Ad #${adNumber}: using the product photo fallback`);
        const hero = await buildHeroScene(reference, brand.colors[0] ?? "#111111", layout);
        await upload(scenePath, hero, "image/png");
        variant = await repo.updateVariant(variant.id, { scene_path: scenePath, model: "fallback" });
        sceneStatus = "warn";
      }
    }

    // 4. Compose (no model calls).
    variant = await repo.updateVariant(variant.id, {}, "composing");
    say(`Composing ad #${adNumber}`);
    const sceneBytes = await download(variant.scene_path!);
    const logo = brand.logo_path ? await download(brand.logo_path).catch(() => null) : null;
    const composed = await composeAd({ scene: Buffer.from(sceneBytes), copy, kit: { colors: brand.colors, font: closestFont(brand.fonts[0]) }, layout, logo: logo ? Buffer.from(logo) : null, forceScrim: dirtyZone || !!(parent?.qa as { layout?: { forced_scrim?: boolean } })?.layout?.forced_scrim && opts.mode === "compose" });
    if (!composed.ok) {
      variant = await repo.updateVariant(variant.id, { error: "copy_too_long", qa: { layout: { attempts: composed.attempts } }, qa_status: "fail" }, "failed");
      return { ok: false, variant, adNumber, reason: "copy_too_long", error: `Headline for ad #${adNumber} doesn't fit at a legible size in any layout.`, attempts: composed.attempts, modelCalls };
    }

    // 5. File before pointer.
    const finalPath = `ad-finals/${ad.id}/${variant.id}.png` as const;
    await upload(finalPath, composed.png, "image/png");
    if (sceneStatus === "skipped" && opts.mode === "full" && !fallback) sceneStatus = "skipped";
    const qaStatus = worst(opts.mode === "compose" ? (parent?.qa_status ?? "skipped") : sceneStatus, composed.qa.status);
    const sceneQaRecord = opts.mode === "compose" ? ((parent?.qa as { scene?: unknown })?.scene ?? { skipped: true }) : sceneQa;
    variant = await repo.updateVariant(variant.id, { final_path: finalPath, layout: composed.layout, qa: { scene: sceneQaRecord, layout: { ...composed.qa, forced_scrim: dirtyZone }, fallback }, qa_status: qaStatus }, "ready");
    await repo.setCurrentVariant(ad.id, variant.id);
    await repo.updateAd(ad.id, { headline: copy.headline, subhead: copy.subhead ?? null, cta: copy.cta, layout: composed.layout });
    say(`Ad #${adNumber} ready`);
    return { ok: true, variant, adNumber, fallback, qaStatus, modelCalls };
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[renderVariant ${variant.id}]`, err);
    variant = await repo.updateVariant(variant.id, { error: message.slice(0, 500) }, "failed").catch(() => variant);
    return { ok: false, variant, adNumber, reason: "error", error: message, modelCalls };
  }
}

