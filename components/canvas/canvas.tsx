"use client";

import { useState } from "react";
import { useCampaign } from "./campaign-data";
import { AdCard } from "./ad-card";
import { AdDetail } from "./ad-detail";

const TABS = ["all", "draft", "approved", "rejected"] as const;
type Tab = (typeof TABS)[number];

export function Canvas({ campaignId }: { campaignId: string }) {
  const { view } = useCampaign();
  const [tab, setTab] = useState<Tab>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const ads = view?.ads ?? [];
  const shown = tab === "all" ? ads : ads.filter((a) => a.status === tab);
  const open = ads.find((a) => a.id === openId) ?? null;
  return (
    <section aria-label="Creative canvas" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-4 py-2" role="tablist" aria-label="Filter ads">
        {TABS.map((t) => {
          const n = t === "all" ? ads.length : ads.filter((a) => a.status === t).length;
          return (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 text-sm capitalize ${tab === t ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>
              {t} <span className="text-xs text-muted-foreground">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {ads.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            <p className="max-w-xs">{view?.brand?.status === "confirmed" ? "Planning your ads…" : "Your ads will appear here once the brand kit is confirmed."}</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No {tab} ads yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4" aria-label="Ads">
            {shown.map((ad) => (
              <li key={ad.id}>
                <AdCard campaignId={campaignId} ad={ad} onOpen={() => setOpenId(ad.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && <AdDetail campaignId={campaignId} ad={open} onClose={() => setOpenId(null)} />}
    </section>
  );
}
