import { getCampaignView } from "@/lib/campaign/view";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/campaigns/[id]">) {
  const { id } = await ctx.params;
  const view = await getCampaignView(id);
  return view ? Response.json(view, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "not found" }, { status: 404 });
}
