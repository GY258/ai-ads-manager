"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { editCopy, listVariants, regenerateWithFeedback, restoreVariant } from "@/app/actions/ads";
import type { AdView, VariantView } from "@/lib/campaign/view";
import { useCampaign } from "./campaign-data";
import { QaBadge, useAdActions } from "./ad-card";

const LAYOUTS = [
  { id: "top_headline", label: "Top" },
  { id: "bottom_card", label: "Bottom card" },
  { id: "split", label: "Split" },
] as const;

export function AdDetail({ campaignId, ad, onClose }: { campaignId: string; ad: AdView; onClose: () => void }) {
  const { refresh } = useCampaign();
  const { approve, reject } = useAdActions(campaignId, ad);
  const [headline, setHeadline] = useState(ad.headline);
  const [subhead, setSubhead] = useState(ad.subhead ?? "");
  const [cta, setCta] = useState(ad.cta);
  const [feedback, setFeedback] = useState("");
  const [scope, setScope] = useState<"both" | "scene" | "copy">("both");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [variants, setVariants] = useState<VariantView[]>([]);
  const v = ad.current;

  useEffect(() => {
    listVariants(ad.id).then(setVariants);
  }, [ad.id, ad.current?.id, ad.variant_count]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setBusy(label);
    setMessage(null);
    const r = await fn();
    setBusy(null);
    setMessage(r.ok ? (ok ? { kind: "info", text: ok } : null) : { kind: "error", text: r.error ?? "Failed" });
    refresh();
    listVariants(ad.id).then(setVariants);
    return r;
  }

  const input = "h-9 w-full rounded-md border bg-background px-2.5 text-sm";
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={`Ad #${ad.number} details`} onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-background shadow-xl md:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2 bg-muted p-4 md:w-[340px]">
          {v?.final_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.final_url} alt={`Ad #${ad.number} full size`} className="w-full rounded-lg shadow" data-testid="detail-image" />
          ) : (
            <div className="aspect-[9/16] w-full animate-pulse rounded-lg bg-muted-foreground/10" />
          )}
          <div className="flex w-full items-center justify-between">
            <QaBadge ad={ad} />
            {v?.final_url && (
              <a href={v.final_url} download={`ad-${ad.number}.png`} className="text-xs underline">
                Download PNG
              </a>
            )}
          </div>
          {v?.qa_status === "warn" && (
            <p className="text-xs text-amber-900">
              {v.model === "fallback" ? "Image generation didn't produce a usable scene, so this uses your real product photo." : "QA: " + (((v.qa as { scene?: { issues?: string[] } }).scene?.issues ?? []).join("; ") || "layout switched to keep text legible")}
            </p>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-5 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Ad #{ad.number} <span className="text-sm font-normal capitalize text-muted-foreground">· {ad.angle.replace("_", " ")} · {ad.status}</span>
            </h2>
            <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-lg leading-none hover:bg-muted">
              ×
            </button>
          </div>

          <form
            className="space-y-2"
            aria-label="Edit copy"
            onSubmit={(e) => {
              e.preventDefault();
              act("copy", () => editCopy(campaignId, ad.id, { headline, subhead, cta }), "Updated");
            }}
          >
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="ad-headline">
              Headline (≤ 6 words)
            </label>
            <input id="ad-headline" className={input} value={headline} onChange={(e) => setHeadline(e.target.value)} />
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="ad-subhead">
              Subhead (≤ 12 words)
            </label>
            <input id="ad-subhead" className={input} value={subhead} onChange={(e) => setSubhead(e.target.value)} />
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="ad-cta">
              CTA (≤ 3 words)
            </label>
            <input id="ad-cta" className={input} value={cta} onChange={(e) => setCta(e.target.value)} />
            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" size="sm" disabled={!!busy || !v || (headline === ad.headline && subhead === (ad.subhead ?? "") && cta === ad.cta)}>
                {busy === "copy" ? "Updating…" : "Update copy"}
              </Button>
              <span className="text-xs text-muted-foreground">Re-composes instantly, no new image.</span>
            </div>
          </form>

          <fieldset>
            <legend className="text-xs font-medium text-muted-foreground">Layout</legend>
            <div className="mt-1 flex gap-1.5">
              {LAYOUTS.map((l) => (
                <button key={l.id} disabled={!!busy || !v} aria-pressed={ad.layout === l.id} onClick={() => act("layout", () => editCopy(campaignId, ad.id, { layout: l.id }))} className={`rounded-md border px-3 py-1.5 text-xs ${ad.layout === l.id ? "border-primary bg-muted font-medium" : ""}`}>
                  {l.label}
                </button>
              ))}
            </div>
          </fieldset>

          <form
            className="space-y-2"
            aria-label="Feedback"
            onSubmit={(e) => {
              e.preventDefault();
              if (!feedback.trim()) return;
              act("regen", () => regenerateWithFeedback(campaignId, ad.id, feedback.trim(), scope), "New version created").then((r) => r.ok && setFeedback(""));
            }}
          >
            <label htmlFor="ad-feedback" className="block text-xs font-medium text-muted-foreground">
              Tell the agent what to change
            </label>
            <textarea id="ad-feedback" rows={2} className="w-full rounded-md border bg-background p-2.5 text-sm" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. darker, more premium, fewer props" />
            <div className="flex items-center gap-2">
              <select aria-label="What to change" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="h-8 rounded-md border bg-background px-2 text-xs">
                <option value="both">Image + copy</option>
                <option value="scene">Image only</option>
                <option value="copy">Copy only</option>
              </select>
              <Button type="submit" size="sm" disabled={!!busy || !feedback.trim()}>
                {busy === "regen" ? "Regenerating…" : "Regenerate"}
              </Button>
            </div>
          </form>

          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-destructive" : "text-emerald-700"}`}>
              {message.text}
            </p>
          )}

          <div className="flex gap-2">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={ad.status === "approved" || v?.status !== "ready"} onClick={() => (v?.qa_status === "warn" && !window.confirm("QA flagged this ad. Approve anyway?") ? null : approve())}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={ad.status === "rejected"} onClick={reject}>
              Reject
            </Button>
          </div>

          <section aria-label="Variant history">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Version history · {variants.length}</h3>
            <ul className="flex gap-2 overflow-x-auto pb-2">
              {variants
                .slice()
                .reverse()
                .map((x, i) => (
                  <li key={x.id} className="w-20 shrink-0 space-y-1" data-testid="variant">
                    <div className={`aspect-[9/16] overflow-hidden rounded border-2 bg-muted ${x.id === v?.id ? "border-primary" : "border-transparent"}`}>
                      {x.final_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={x.final_url} alt={`Version ${variants.length - i}`} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-[10px] text-muted-foreground">{x.status}</span>
                      )}
                    </div>
                    {x.id === v?.id ? (
                      <p className="text-center text-[10px] font-medium">Current</p>
                    ) : x.status === "ready" ? (
                      <button className="w-full rounded border text-[10px]" onClick={() => act("restore", () => restoreVariant(campaignId, ad.id, x.id))}>
                        Restore
                      </button>
                    ) : (
                      <p className="text-center text-[10px] text-muted-foreground">{x.error === "copy_too_long" ? "too long" : x.status}</p>
                    )}
                  </li>
                ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}
