"use client";

import { useCampaign } from "./campaign-data";

/** Phase 3 placeholder: the full grid lands with generation. */
export function Canvas({ campaignId }: { campaignId: string }) {
  const { view } = useCampaign();
  void campaignId;
  return (
    <section aria-label="Creative canvas" className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
      {view?.ads.length ? `${view.ads.length} ads` : "Your ads will appear here once the brand kit is confirmed."}
    </section>
  );
}
