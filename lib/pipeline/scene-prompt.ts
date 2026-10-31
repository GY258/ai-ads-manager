import type { Layout } from "@/lib/compose/contrast";

// The product keeps its own printed logo: banning "logos" outright made QA fail every branded product (Ridge, Loopy).
export const NEGATIVE =
  "Do not add any text, letters, numbers, logos or watermarks to the scene. Keep the product exactly identical to the reference photo: same shape, parts, colors, print and its own logo.";
export const HERO = "The product is the clear hero: in sharp focus and about 40% of the frame width.";

/** The layout owns the empty zone; planner wording like "top area empty" contradicted it and squeezed the scene. */
export function stripZoneWording(scene: string) {
  return scene
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/\b(empty|text area|text zone|negative space|copy space)\b/i.test(s))
    .join(" ")
    .trim();
}

export const ZONE_PHRASE: Record<Layout, string> = {
  top_headline: "Leave the top 32% of the frame completely empty (smooth, uncluttered background) for a headline.",
  bottom_card: "Leave the bottom 30% of the frame completely empty (smooth, uncluttered background) for text.",
  split: "Leave the top 22% and the bottom 14% of the frame empty (top and bottom bands of smooth background) for text.",
};

export function buildScenePrompt(a: { scenePrompt: string; layout: Layout; brandColors: string[]; constraints: string[]; delta?: string | null; corrective?: string[] }) {
  return [
    `Vertical 9:16 product ad photo. ${stripZoneWording(a.scenePrompt)}`,
    HERO,
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
