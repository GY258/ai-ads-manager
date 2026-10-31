"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadConcepts, submitConcepts } from "@/app/actions/campaign";
import type { ConceptView } from "@/lib/campaign/concepts";

const LAYOUTS = [
  { id: "top_headline", label: "Top" },
  { id: "bottom_card", label: "Bottom" },
  { id: "split", label: "Split" },
] as const;

type Row = ConceptView & { keep: boolean };
export type ConceptResult = { ok: true; approved: { id: string; number: number; headline: string }[]; removed: number; edited: number };

/** HITL: the user edits, removes or approves planned concepts before any image is generated. */
export function ConceptReview({ campaignId, adIds, onDone }: { campaignId: string; adIds: string[]; onDone: (r: ConceptResult) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  useEffect(() => {
    loadConcepts(campaignId, adIds).then((c) => setRows(c.map((x) => ({ ...x, keep: true }))));
  }, [campaignId, adIds]);
  if (!rows) return <p className="text-sm text-muted-foreground">Loading concepts…</p>;
  const set = (id: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const kept = rows.filter((r) => r.keep).length;

  async function approve() {
    setPending(true);
    const r = await submitConcepts(
      campaignId,
      rows!.map((x) => ({ id: x.id, keep: x.keep, headline: x.headline.trim(), subhead: x.subhead?.trim() || null, cta: x.cta.trim(), layout: x.layout })),
    );
    setPending(false);
    if (r.ok) onDone(r);
    else setErrors(r.errors);
  }

  const input = "h-8 w-full rounded-lg border bg-background px-2 text-sm";
  return (
    <form aria-label="Review concepts" className="min-w-0 space-y-3" onSubmit={(e) => (e.preventDefault(), approve())}>
      {rows.map((r) => (
        <fieldset key={r.id} data-testid="concept" className={`min-w-0 space-y-2 rounded-2xl border bg-background p-3 ${r.keep ? "" : "opacity-50"}`}>
          <legend className="sr-only">Concept #{r.number}</legend>
          <div className="flex items-center gap-2">
            {r.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            )}
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-semibold">
                #{r.number} · <span className="capitalize">{r.angle.replace("_", " ")}</span>
              </div>
              <div className="truncate text-muted-foreground">{r.product}</div>
            </div>
            <button type="button" onClick={() => set(r.id, { keep: !r.keep })} className="shrink-0 rounded-full border px-2.5 py-1 text-xs">
              {r.keep ? "Remove" : "Keep"}
            </button>
          </div>
          {r.keep && (
            <>
              <input aria-label={`Concept ${r.number} headline`} className={input} value={r.headline} onChange={(e) => set(r.id, { headline: e.target.value })} />
              <textarea aria-label={`Concept ${r.number} subhead`} rows={2} className="block w-full resize-none rounded-lg border bg-background px-2 py-1.5 text-sm" value={r.subhead ?? ""} placeholder="Subhead (optional)" onChange={(e) => set(r.id, { subhead: e.target.value })} />
              <div className="flex flex-wrap gap-2">
                <input aria-label={`Concept ${r.number} CTA`} className={`${input} min-w-0 flex-1 basis-28`} value={r.cta} onChange={(e) => set(r.id, { cta: e.target.value })} />
                <div className="flex shrink-0 gap-1" role="group" aria-label={`Concept ${r.number} layout`}>
                  {LAYOUTS.map((l) => (
                    <button key={l.id} type="button" aria-pressed={r.layout === l.id} onClick={() => set(r.id, { layout: l.id })} className={`h-8 rounded-full border px-2.5 text-xs ${r.layout === l.id ? "border-foreground bg-foreground text-background" : ""}`}>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <details className="break-words text-xs text-muted-foreground">
                <summary className="cursor-pointer">Scene</summary>
                {r.scene_prompt}
              </details>
              {errors[r.id] && <p className="text-xs text-destructive">{errors[r.id]}</p>}
            </>
          )}
        </fieldset>
      ))}
      <Button type="submit" disabled={pending || kept === 0} className="w-full rounded-full">
        {pending ? "Saving…" : `Approve & generate ${kept} ad${kept === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
