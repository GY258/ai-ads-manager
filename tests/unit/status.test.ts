import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, TransitionError } from "@/lib/db/status";

describe("status transitions", () => {
  it("allows the happy path for variants", () => {
    expect(() => {
      assertTransition("variant", "queued", "generating_scene");
      assertTransition("variant", "generating_scene", "composing");
      assertTransition("variant", "composing", "ready");
    }).not.toThrow();
  });
  it("copy-only renders skip scene generation", () => {
    expect(canTransition("variant", "queued", "composing")).toBe(true);
  });
  it("rejects going backwards: ready → queued throws", () => {
    expect(() => assertTransition("variant", "ready", "queued")).toThrow(TransitionError);
    expect(() => assertTransition("variant", "failed", "composing")).toThrow(TransitionError);
  });
  it("brands: researching → draft → confirmed; draft cannot skip back from confirmed to failed", () => {
    expect(canTransition("brand", "researching", "draft")).toBe(true);
    expect(canTransition("brand", "draft", "confirmed")).toBe(true);
    expect(canTransition("brand", "researching", "confirmed")).toBe(false);
    expect(canTransition("brand", "confirmed", "failed")).toBe(false);
  });
  it("ads: rejected → draft on regenerate", () => {
    expect(canTransition("ad", "rejected", "draft")).toBe(true);
    expect(canTransition("ad", "draft", "approved")).toBe(true);
  });
});
