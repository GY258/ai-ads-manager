import { describe, expect, it } from "vitest";
import { buildScenePrompt } from "@/lib/pipeline/scene-prompt";

describe("scene prompt", () => {
  // Live Loopy run: the planner said "top area empty" while bottom_card added "bottom 30% empty" → two flat bands.
  it("keeps only the layout's empty-zone wording", () => {
    const p = buildScenePrompt({
      scenePrompt: "A sunlit cafe terrace with a pink Loopy case. The top area is empty (text area for headline) and the bottom area is empty as per layout.",
      layout: "bottom_card",
      brandColors: ["#8FE8B3"],
      constraints: [],
    });
    expect(p).toContain("A sunlit cafe terrace with a pink Loopy case.");
    expect(p).not.toMatch(/top area is empty/i);
    expect(p.match(/empty/gi)).toHaveLength(1);
    expect(p).toContain("its own logo");
  });
});
