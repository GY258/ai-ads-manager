"use client";

import { useCampaign } from "@/components/canvas/campaign-data";

/** Thumbnails that fill in as variants become ready. */
export function GenerationStrip({ adIds }: { campaignId: string; adIds: string[] }) {
  const { view } = useCampaign();
  const ads = (view?.ads ?? []).filter((a) => adIds.includes(a.id));
  if (!ads.length) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Generated ads">
      {ads.map((a) => {
        const v = a.pending ?? a.current;
        const ready = v?.status === "ready" && v.final_url;
        return (
          <div key={a.id} className="relative aspect-[9/16] w-12 shrink-0 overflow-hidden rounded bg-muted" title={`#${a.number} ${a.headline}`}>
            {ready ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v!.final_url!} alt={`Ad #${a.number}`} className="h-full w-full object-cover" />
            ) : v?.status === "failed" ? (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-destructive">failed</span>
            ) : (
              <span className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
            )}
            <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] text-white">{a.number}</span>
          </div>
        );
      })}
    </div>
  );
}
