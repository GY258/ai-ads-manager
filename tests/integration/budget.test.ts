import { afterEach, describe, expect, it } from "vitest";
import { imageGenerator } from "@/lib/adapters/image-gen";
import { spentUsd } from "@/lib/db/repo";
import { useFreshDb } from "../support/db";

describe("live image budget", () => {
  useFreshDb();
  afterEach(() => {
    process.env.AI_MODE = "mock";
    delete process.env.LIVE_BUDGET_USD;
  });
  it("charges each call to the ledger and refuses once the next call would exceed LIVE_BUDGET_USD", async () => {
    process.env.AI_MODE = "live";
    process.env.LIVE_BUDGET_USD = "0.05";
    const savedKey = process.env.FAL_KEY;
    delete process.env.FAL_KEY; // the provider call itself fails offline; the ledger still records the attempt
    const req = { prompt: "x", referenceUrl: "https://x", referenceBytes: new Uint8Array() };
    await expect(imageGenerator().generate(req)).rejects.toThrow(/FAL_KEY not configured/);
    expect(await spentUsd()).toBeCloseTo(0.0398);
    await expect(imageGenerator().generate(req)).rejects.toThrow(/budget reached/);
    expect(await spentUsd()).toBeCloseTo(0.0398);
    if (savedKey) process.env.FAL_KEY = savedKey;
  });
});
