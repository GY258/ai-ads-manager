"use server";

import { redirect } from "next/navigation";
import * as repo from "@/lib/db/repo";
import { normalizeStoreUrl } from "@/lib/agent/tools/research-store";
import { httpGet } from "@/lib/adapters/http";
import { brandKitSchema, type BrandKit } from "@/lib/agent/schemas";
import { confirmBrandKit, getBrandKitData } from "@/lib/campaign/brand-kit";

export type UrlFormState = { error?: string; url?: string };

/** Home form: validate + reachability check, then create the campaign and open it. */
export async function startCampaign(_prev: UrlFormState, form: FormData): Promise<UrlFormState> {
  const url = String(form.get("url") ?? "").trim();
  const norm = normalizeStoreUrl(url);
  if (!norm) return { url, error: "That doesn't look like a store URL. Try something like www.loopycases.com" };
  const reachable = await httpGet(`${norm.origin}/`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.status < 500, () => false);
  if (!reachable) return { url, error: `We couldn't reach ${norm.domain}. Check the address — for example https://www.loopycases.com` };
  const campaign = await repo.createCampaign(norm.origin, norm.domain);
  redirect(`/c/${campaign.id}?start=1`);
}

export async function loadBrandKit(brandId: string) {
  return getBrandKitData(brandId);
}

export type ConfirmResult = { ok: true; result: Awaited<ReturnType<typeof confirmBrandKit>> } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function submitBrandKit(campaignId: string, brandId: string, kit: BrandKit): Promise<ConfirmResult> {
  const parsed = brandKitSchema.safeParse(kit);
  if (!parsed.success) {
    return { ok: false, error: "Some fields need a fix.", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  try {
    return { ok: true, result: await confirmBrandKit(campaignId, brandId, parsed.data) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
