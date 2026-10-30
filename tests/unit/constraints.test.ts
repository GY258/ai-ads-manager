import { describe, expect, it } from "vitest";
import { mergeConstraintList } from "@/lib/db/repo";

describe("constraint merging", () => {
  it("appends new constraints and dedupes case-insensitively", () => {
    expect(mergeConstraintList(["avoid busy backgrounds"], ["Avoid busy backgrounds", "prefer lifestyle shots", " ", "prefer lifestyle shots"])).toEqual([
      "avoid busy backgrounds",
      "prefer lifestyle shots",
    ]);
  });
});
