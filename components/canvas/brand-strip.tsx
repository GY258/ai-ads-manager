"use client";

import { useState } from "react";
import { useCampaign } from "./campaign-data";

/** Collapsible header strip: logo, colors, voice. */
export function BrandStrip() {
  const { view } = useCampaign();
  const [open, setOpen] = useState(false);
  const b = view?.brand;
  if (!b) return <span className="text-sm text-muted-foreground">{view?.campaign.store_url.replace(/^https?:\/\//, "")}</span>;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted" title="Brand kit details">
        {b.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logo_url} alt="" className="h-6 max-w-16 object-contain" />
        )}
        <span className="truncate text-sm font-medium">{b.name}</span>
        <span className="flex gap-0.5">
          {b.colors.slice(0, 4).map((c) => (
            <span key={c} className="h-3.5 w-3.5 rounded-full border" style={{ background: c }} />
          ))}
        </span>
        <span className="rounded bg-muted px-1.5 text-[10px] text-foreground/80">{b.status}</span>
      </button>
      {open && (
        <span className="hidden truncate text-xs text-muted-foreground sm:block">
          Voice: {b.voice} · Font: {b.fonts[0]}
          {view?.campaign.goal && ` · Goal: ${view.campaign.goal}`}
          {view?.campaign.constraints.length ? ` · Rules: ${view.campaign.constraints.join("; ")}` : ""}
        </span>
      )}
    </div>
  );
}
