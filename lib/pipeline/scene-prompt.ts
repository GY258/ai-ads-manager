import type { Layout } from "@/lib/compose/contrast";

export const NEGATIVE = "No text, no letters, no numbers, no logos, no watermarks. Keep the product exactly identical to the reference photo: same shape, colors and print.";

export const ZONE_PHRASE: Record<Layout, string> = {
  top_headline: "Leave the top 32% of the frame completely empty (smooth, uncluttered background) for a headline.",
  bottom_card: "Leave the bottom 30% of the frame completely empty (smooth, uncluttered background) for text.",
  split: "Leave the top 22% and the bottom 14% of the frame empty (top and bottom bands of smooth background) for text.",
};

export function buildScenePrompt(a: { scenePrompt: string; layout: Layout; brandColors: string[]; constraints: string[]; delta?: string | null; corrective?: string[] }) {
  return [
    `Vertical 9:16 product ad photo. ${a.scenePrompt.trim()}`,
    `Use the reference photo's product as the hero. Brand colors: ${a.brandColors.slice(0, 3).join(", ")}.`,
    ZONE_PHRASE[a.layout],
    a.constraints.length ? `Rules: ${a.constraints.join("; ")}.` : "",
    a.delta ? `Change from the previous version: ${a.delta}.` : "",
    a.corrective?.length ? `Fix these problems from the last attempt: ${a.corrective.join("; ")}.` : "",
    NEGATIVE,
  ]
    .filter(Boolean)
    .join("\n");
}
