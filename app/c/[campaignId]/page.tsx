import { ChatPanel } from "@/components/chat/chat-panel";

export default async function CampaignPage({ params }: PageProps<"/c/[campaignId]">) {
  const { campaignId } = await params;
  return (
    <main className="flex h-dvh">
      <ChatPanel campaignId={campaignId} />
    </main>
  );
}
