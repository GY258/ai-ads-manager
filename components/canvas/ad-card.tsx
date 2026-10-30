"use client";

import { useState } from "react";
import { approveAd, rejectAd, retryAd } from "@/app/actions/ads";
import type { AdView } from "@/lib/campaign/view";
import { useCampaign } from "./campaign-data";

const STATUS_LABEL: Record<string, string> = { queued: "Queued…", generating_scene: "Generating scene…", composing: "Adding text…" };

export function useAdActions(campaignId: string, ad: AdView) {
  const { patchAd, refresh } = useCampaign();
  const [error, setError] = useState<string | null>(null);
  const run = async (optimistic: Partial<AdView> | null, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    const before = { status: ad.status };
    if (optimistic) patchAd(ad.id, optimistic);
    setError(null);
    const r = await fn();
    if (!r.ok) {
      if (optimistic) patchAd(ad.id, before);
      setError(r.error ?? "Something went wrong");
    }
    refresh();
    return r;
  };
  return {
    error,
    approve: () => run({ status: "approved" }, () => approveAd(campaignId, ad.id)),
    reject: () => run({ status: "rejected" }, () => rejectAd(campaignId, ad.id)),
    retry: () => run({ pending: { ...(ad.current ?? ad.pending)!, status: "generating_scene" } }, () => retryAd(campaignId, ad.id)),
  };
}

export function QaBadge({ ad }: { ad: AdView }) {
  const v = ad.current;
  if (!v) return null;
  if (v.model === "fallback") return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">Product-photo fallback</span>;
  if (v.qa_status === "warn") return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">QA: check</span>;
  if (v.qa_status === "pass") return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">QA pass</span>;
  return null;
}

export function ReadinessBadge({ ad }: { ad: AdView }) {
  const r = ad.current?.readiness;
  if (!r) return null;
  const tone = r.grade === "ready" ? "bg-emerald-100 text-emerald-900" : r.grade === "ok" ? "bg-sky-100 text-sky-900" : "bg-rose-100 text-rose-900";
  return (
    <span title={r.checks.map((c) => `${c.label}: ${c.detail}`).join("\n")} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      Placement {r.score}
    </span>
  );
}

export function AdCard({ campaignId, ad, onOpen }: { campaignId: string; ad: AdView; onOpen: () => void }) {
  const { approve, reject, retry, error } = useAdActions(campaignId, ad);
  const { view } = useCampaign();
  const [confirming, setConfirming] = useState(false);
  const v = ad.current;
  const busy = ad.pending ?? (v && !["ready", "failed"].includes(v.status) ? v : null);
  const failed = !busy && v?.status === "failed";
  const needsConfirm = v?.qa_status === "warn" || v?.model === "fallback";

  return (
    <article aria-label={`Ad #${ad.number}`} data-status={ad.status} className="group relative overflow-hidden rounded-2xl bg-muted">
      <button onClick={onOpen} className="relative block aspect-[9/16] w-full overflow-hidden rounded-2xl bg-muted text-left" aria-label={`Open ad #${ad.number}`}>
        <span className="absolute bottom-2 left-2 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">#{ad.number}</span>
        {v?.status === "ready" && v.final_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.final_url} alt={`Ad #${ad.number}: ${ad.headline}`} className={`h-full w-full object-cover ${busy ? "opacity-50" : ""}`} />
        )}
        {busy && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/60" data-testid="skeleton">
            <span className="h-2/3 w-2/3 animate-pulse rounded-lg bg-muted-foreground/15" />
            <span className="text-xs text-muted-foreground">{STATUS_LABEL[busy.status] ?? "Working…"}</span>
          </span>
        )}
        {!busy && !v && (
          <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted-foreground">Planned: “{ad.headline}”</span>
        )}
        {failed && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-3 text-center text-xs text-destructive">
            <span>{v?.error === "copy_too_long" ? "Headline too long to render" : "Couldn't render this ad"}</span>
          </span>
        )}
      </button>
            {ad.status !== "draft" && (
        <span className={`absolute right-2 top-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${ad.status === "approved" ? "bg-emerald-600 text-white" : "bg-zinc-700 text-white"}`}>{ad.status}</span>
      )}
      <div className="flex flex-wrap items-center gap-1.5 p-2">
        <ReadinessBadge ad={ad} />
        <QaBadge ad={ad} />
        <span className="text-[11px] capitalize text-muted-foreground">{ad.angle.replace("_", " ")}</span>
      </div>
      {(failed || v?.model === "fallback") && !busy && (
        <div className="px-2 pb-2">
          <button onClick={retry} className="w-full rounded-full border border-foreground/15 bg-white px-2 py-1.5 text-xs font-medium hover:bg-background">
            Retry
          </button>
        </div>
      )}
      {!v && !busy && !view?.inflight && (
        <div className="px-2 pb-2">
          <button onClick={retry} className="w-full rounded-full border border-foreground/15 bg-white px-2 py-1.5 text-xs font-medium hover:bg-background">
            Render
          </button>
        </div>
      )}
      {confirming ? (
        <div role="alertdialog" aria-label="Confirm approval" className="space-y-1.5 border-t bg-amber-50 p-2 text-xs text-amber-900">
          <p>{v?.model === "fallback" ? "This is the product-photo fallback." : "QA flagged this ad."} Approve anyway?</p>
          <div className="flex gap-1.5">
            <button className="flex-1 rounded-md bg-emerald-600 px-2 py-1 font-medium text-white" onClick={() => (setConfirming(false), approve())}>
              Approve anyway
            </button>
            <button className="flex-1 rounded-md border px-2 py-1" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        v?.status === "ready" &&
        !busy && (
          <div className="flex gap-1.5 p-2 opacity-100 transition md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <button className="flex-1 rounded-full bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40" disabled={ad.status === "approved"} onClick={() => (needsConfirm ? setConfirming(true) : approve())}>
              Approve
            </button>
            <button className="flex-1 rounded-full border border-foreground/15 bg-white px-2 py-1.5 text-xs font-medium disabled:opacity-40" disabled={ad.status === "rejected"} onClick={reject}>
              Reject
            </button>
          </div>
        )
      )}
      {error && (
        <p role="alert" className="px-2 pb-2 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}
