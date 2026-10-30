"use client";

import Link from "next/link";
import { useState } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { CampaignDataProvider, useCampaign } from "@/components/canvas/campaign-data";
import { Canvas } from "@/components/canvas/canvas";
import { BrandStrip } from "@/components/canvas/brand-strip";
import type { CampaignView } from "@/lib/campaign/view";
import type { AppUIMessage } from "@/lib/agent/tools";

export function CampaignScreen({ campaignId, initialView, initialMessages }: { campaignId: string; initialView: CampaignView; initialMessages: AppUIMessage[] }) {
  return (
    <CampaignDataProvider campaignId={campaignId} initial={initialView}>
      <Layout campaignId={campaignId} storeUrl={initialView.campaign.store_url} initialMessages={initialMessages} />
    </CampaignDataProvider>
  );
}

function Layout({ campaignId, storeUrl, initialMessages }: { campaignId: string; storeUrl: string; initialMessages: AppUIMessage[] }) {
  const { refresh, view } = useCampaign();
  const [tab, setTab] = useState<"chat" | "canvas">("chat");
  const readyCount = view?.ads.filter((a) => a.current?.status === "ready").length ?? 0;
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center gap-4 px-5 py-3">
        <Link href="/" className="display text-xl">
          AI Ads Manager
        </Link>
        <BrandStrip />
      </header>
      <div className="mx-3 mb-2 flex gap-1 rounded-full bg-white p-1 md:hidden" role="tablist" aria-label="View">
        {(["chat", "canvas"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 rounded-full py-2 text-sm font-medium capitalize ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            {t === "canvas" ? `Ads${readyCount ? ` (${readyCount})` : ""}` : "Chat"}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <div className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 w-full flex-col overflow-hidden rounded-3xl bg-white md:flex md:w-[420px] md:shrink-0`}>
          <ChatPanel campaignId={campaignId} storeUrl={storeUrl} initialMessages={initialMessages} onActivity={refresh} />
        </div>
        <div className={`${tab === "canvas" ? "flex" : "hidden"} min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-white md:flex`}>
          <Canvas campaignId={campaignId} />
        </div>
      </div>
    </div>
  );
}
