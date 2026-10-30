"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CampaignView } from "@/lib/campaign/view";

type Ctx = { view: CampaignView | null; refresh: () => void; patchAd: (id: string, patch: Partial<CampaignView["ads"][number]>) => void };
const CampaignCtx = createContext<Ctx>({ view: null, refresh: () => {}, patchAd: () => {} });

/** Polls the campaign every 2s while anything renders (or the chat is active), else every 15s. */
export function CampaignDataProvider({ campaignId, initial, children }: { campaignId: string; initial: CampaignView | null; children: React.ReactNode }) {
  const [view, setView] = useState(initial);
  const busyUntil = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
      if (res.ok) setView(await res.json());
    } catch {
      /* offline: keep last view */
    }
  }, [campaignId]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      await load();
      if (!alive) return;
      const fast = Date.now() < busyUntil.current || viewRef.current?.inflight;
      timer.current = setTimeout(tick, fast ? 2000 : 15000);
    };
    timer.current = setTimeout(tick, 2000);
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const refresh = useCallback(() => {
    busyUntil.current = Date.now() + 20_000;
    void load();
  }, [load]);
  const patchAd = useCallback((id: string, patch: Partial<CampaignView["ads"][number]>) => {
    setView((v) => v && { ...v, ads: v.ads.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }, []);

  return <CampaignCtx.Provider value={{ view, refresh, patchAd }}>{children}</CampaignCtx.Provider>;
}

export const useCampaign = () => useContext(CampaignCtx);
