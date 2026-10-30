import { notFound } from "next/navigation";
import { Suspense } from "react";
import * as repo from "@/lib/db/repo";
import { getCampaignView } from "@/lib/campaign/view";
import type { AppUIMessage } from "@/lib/agent/tools";
import { CampaignScreen } from "@/components/campaign-screen";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: PageProps<"/c/[campaignId]">) {
  const { campaignId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(campaignId)) notFound();
  const view = await getCampaignView(campaignId);
  if (!view) notFound();
  const messages = await repo.loadMessages<AppUIMessage>(campaignId);
  return (
    <Suspense>
      <CampaignScreen campaignId={campaignId} initialView={view} initialMessages={messages} />
    </Suspense>
  );
}
