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
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Link href="/" className="text-sm font-semibold">
          AI Ads Manager
        </Link>
        <BrandStrip />
      </header>
      <div className="flex border-b md:hidden" role="tablist" aria-label="View">
        {(["chat", "canvas"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}>
            {t === "canvas" ? `Ads${readyCount ? ` (${readyCount})` : ""}` : "Chat"}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 w-full flex-col border-r md:flex md:w-[420px] md:shrink-0`}>
          <ChatPanel campaignId={campaignId} storeUrl={storeUrl} initialMessages={initialMessages} onActivity={refresh} />
        </div>
        <div className={`${tab === "canvas" ? "flex" : "hidden"} min-h-0 flex-1 flex-col md:flex`}>
          <Canvas campaignId={campaignId} />
        </div>
      </div>
    </div>
  );
}
