import { tool, type InferUITools, type UIMessage, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { researchStore, researchStoreInput } from "./research-store";
import { generateAds, generateAdsInput, planConcepts, planConceptsInput } from "./generation";
import type { Progress } from "./types";

export type ProgressData = { tool: string; toolCallId: string; message: string; data?: Record<string, unknown> };

type Writer = Pick<UIMessageStreamWriter, "write"> | null;

function progressFor(writer: Writer, toolName: string, toolCallId: string): Progress {
  let n = 0;
  return (message, data) => writer?.write({ type: "data-progress", id: `${toolCallId}-${n++}`, data: { tool: toolName, toolCallId, message, data } satisfies ProgressData });
}

export const confirmBrandKitOutput = z.object({
  ok: z.boolean(),
  brandId: z.string().optional(),
  name: z.string().optional(),
  colors: z.array(z.string()).optional(),
  font: z.string().optional(),
  products: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  goal: z.string().optional(),
  offer: z.string().nullable().optional(),
  constraints: z.array(z.string()).optional(),
  edited_fields: z.array(z.string()).optional(),
  error: z.string().optional(),
});

/** All tools the main agent can call, bound to one campaign and the response stream. */
export function buildTools(campaignId: string, writer: Writer = null) {
  return {
    researchStore: tool({
      description: "Read a store: products, brand signals, and a drafted brand kit. Call first with the store URL.",
      inputSchema: researchStoreInput,
      execute: (input, { toolCallId }) => researchStore(input, { campaignId, progress: progressFor(writer, "researchStore", toolCallId) }),
    }),
    confirmBrandKit: tool({
      description: "Show the user the editable brand kit form (logo, colors, font, voice, products, goal). The user's answer comes back as the result. Call right after a successful researchStore.",
      inputSchema: z.object({ brandId: z.string().describe("brandId returned by researchStore") }),
      outputSchema: confirmBrandKitOutput,
      // No execute: human in the loop. The client renders BrandKitForm and returns the result with addToolOutput.
    }),
    planConcepts: tool({
      description: "Plan ad concepts (angle, product photo, copy, layout, scene) for the confirmed brand kit and save them as draft ads. Applies all campaign constraints and recent feedback.",
      inputSchema: planConceptsInput,
      execute: (input, { toolCallId }) => planConcepts(input, { campaignId, progress: progressFor(writer, "planConcepts", toolCallId) }),
    }),
    generateAds: tool({
      description: "Render images for planned ads (max 6 per call; default: all ads without an image). Generates the scene around the real product photo, then draws text with our compositor.",
      inputSchema: generateAdsInput,
      execute: (input, { toolCallId }) => generateAds(input, { campaignId, progress: progressFor(writer, "generateAds", toolCallId) }),
    }),
  };
}

export type AppTools = ReturnType<typeof buildTools>;
export type AppUIMessage = UIMessage<never, { progress: ProgressData }, InferUITools<AppTools>>;
