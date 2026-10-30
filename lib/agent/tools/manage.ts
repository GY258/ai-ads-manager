import { z } from "zod";
import * as ops from "@/lib/campaign/ad-ops";
import { runTool } from "./run";
import type { ToolContext } from "./types";

const adRef = z.string().describe("Ad number as shown on the canvas (e.g. \"3\") or its id");

export const regenerateAdInput = z.object({
  adId: adRef,
  feedback: z.string().min(1).describe("What to change, made specific (e.g. 'darker background, no props')"),
  scope: z.enum(["scene", "copy", "both"]).describe("scene = new image, copy = rewrite text only (no new image), both"),
});
export const editAdCopyInput = z.object({
  adId: adRef,
  headline: z.string().optional(),
  subhead: z.string().optional(),
  cta: z.string().optional(),
  layout: z.enum(["top_headline", "bottom_card", "split"]).optional(),
});
export const setAdStatusInput = z.object({ adId: adRef, status: z.enum(["draft", "approved", "rejected"]) });
export const recordFeedbackInput = z.object({
  campaignId: z.string(),
  adId: adRef.optional().describe("Only for feedback about one ad"),
  text: z.string().min(1).describe("The user's feedback, verbatim"),
  constraints: z.array(z.string()).describe("Concrete rules for all future ads, e.g. 'avoid busy backgrounds', 'serif headline'"),
});

export const regenerateAd = (i: z.infer<typeof regenerateAdInput>, ctx: ToolContext) =>
  runTool("regenerateAd", ctx.campaignId, i, () => ops.regenerate(ctx.campaignId, i.adId, i.feedback, i.scope, "agent", ctx.progress));

export const editAdCopy = (i: z.infer<typeof editAdCopyInput>, ctx: ToolContext) =>
  runTool("editAdCopy", ctx.campaignId, i, async () => ({ result: await ops.editCopy(ctx.campaignId, i.adId, i, "agent", ctx.progress) }));

export const setAdStatus = (i: z.infer<typeof setAdStatusInput>, ctx: ToolContext) =>
  runTool("setAdStatus", ctx.campaignId, i, async () => ({ result: await ops.setStatus(ctx.campaignId, i.adId, i.status, "agent") }));

export const recordFeedback = (i: z.infer<typeof recordFeedbackInput>, ctx: ToolContext) =>
  runTool("recordFeedback", ctx.campaignId, i, async () => ({ result: await ops.recordFeedback(ctx.campaignId, i.adId, i.text, i.constraints) }));
