import { describe, expect, it } from "vitest";
import * as repo from "@/lib/db/repo";
import { mockCalls } from "@/lib/adapters/llm";
import { buildStateSummary, approxTokens } from "@/lib/agent/system-prompt";
import { confirmBrandKit } from "@/lib/campaign/brand-kit";
import type { AppUIMessage } from "@/lib/agent/tools";
import { useFreshDb } from "../support/db";
import { useMsw } from "../support/msw";
import { assistantFrom, postChat, text, toolCalls, userMsg } from "../support/chat";
import { newCampaign } from "../support/factories";

describe("/api/chat (mock LLM)", () => {
  useFreshDb();
  useMsw();

  it("streams a valid UI message stream for a plain text reply", async () => {
    const c = await newCampaign();
    const { res, chunks } = await postChat(c.id, [userMsg("hello")]);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(chunks[0].type).toBe("start");
    expect(chunks.at(-1)!.type).toBe("finish");
    expect(text(chunks)).toMatch(/Paste a store URL/);
  });

  it("onboard: researchStore → confirmBrandKit, and the stream ends with a pending tool call (the pause works)", async () => {
    const c = await newCampaign();
    const first = userMsg("Make ads for www.loopycases.com");
    const { chunks } = await postChat(c.id, [first]);
    expect(toolCalls(chunks)).toEqual(["researchStore", "confirmBrandKit"]);
    const outputs = chunks.filter((c) => c.type === "tool-output-available");
    expect(outputs).toHaveLength(1); // researchStore ran; confirmBrandKit has no execute
    expect((outputs[0].output as { ok: boolean }).ok).toBe(true);
    expect(chunks.some((c) => c.type === "data-progress" && /Found 40 products/.test(String((c.data as { message: string }).message)))).toBe(true);

    // Persisted: user message immediately, assistant message on end, in order.
    const saved = await repo.loadMessages<AppUIMessage>(c.id);
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved[0].id).toBe(first.id);
    const pending = saved[1].parts.find((p) => p.type === "tool-confirmBrandKit") as { state: string } | undefined;
    expect(pending?.state).toBe("input-available");
  });

  it("a tool returning ok:false results in a text reply, not a thrown error or 500", async () => {
    const c = await newCampaign("https://empty-shop.example");
    const { res, chunks } = await postChat(c.id, [userMsg("Make ads for empty-shop.example")]);
    expect(res.status).toBe(200);
    expect(chunks.some((c) => c.type === "error")).toBe(false);
    expect(text(chunks)).toMatch(/product page URLs, or upload product photos/);
  });

  it("the system prompt includes the state summary for the campaign", async () => {
    const c = await newCampaign();
    mockCalls.length = 0;
    await postChat(c.id, [userMsg("hello")]);
    const prompt = mockCalls.find((m) => m.role === "chat")!.prompt;
    expect(prompt).toContain(`Campaign id: ${c.id}`);
    expect(prompt).toContain("Brand: not researched yet");
  });

  it("messages persist and reload in order across turns", async () => {
    const c = await newCampaign();
    const m1 = userMsg("hello");
    const r1 = await postChat(c.id, [m1]);
    const a1 = assistantFrom(r1.chunks);
    const m2 = userMsg("hi again");
    await postChat(c.id, [m1, a1, m2]);
    const saved = await repo.loadMessages<AppUIMessage>(c.id);
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(saved[2].id).toBe(m2.id);
  });

  it("unknown campaign → 404", async () => {
    const { res } = await postChat("00000000-0000-4000-8000-00000000dead", [userMsg("hi")]);
    expect(res.status).toBe(404);
  });
});

describe("confirm brand kit", () => {
  useFreshDb();
  useMsw();

  it("sets confirmed, saves selected products on the campaign, stores user edits over inferred values", async () => {
    const c = await newCampaign();
    await postChat(c.id, [userMsg("Make ads for www.loopycases.com")]);
    const brand = (await repo.getBrandByDomain("loopycases.com"))!;
    expect(brand.source.voice).toBe("inferred");
    const heroIds = (brand.source as unknown as { hero_product_ids: string[] }).hero_product_ids;
    const products = (await repo.listProducts(brand.id)).filter((p) => heroIds.includes(p.id)).slice(0, 2);
    const r = await confirmBrandKit(c.id, brand.id, {
      name: brand.name!,
      colors: ["#ff4fa3", ...brand.colors.slice(1, 2)],
      font: "Exo 2",
      voice: "cheeky and bold",
      audience: brand.audience!,
      product_ids: products.map((p) => p.id),
      goal: "Holiday gifting",
      offer: "",
      avoid: "busy backgrounds, stock-photo people",
      tone_words: [],
    });
    const after = (await repo.getBrand(brand.id))!;
    expect(after.status).toBe("confirmed");
    expect(after.colors[0]).toBe("#FF4FA3");
    expect(after.voice).toBe("cheeky and bold");
    expect(after.fonts[0]).toBe("Exo 2");
    expect(after.source).toMatchObject({ colors: "user", voice: "user", fonts: "user", audience: "inferred" });
    expect(r.edited_fields.sort()).toEqual(["colors", "fonts", "voice"]);
    const camp = (await repo.getCampaign(c.id))!;
    expect(camp.product_ids).toEqual(products.map((p) => p.id));
    expect(camp.status).toBe("active");
    expect(camp.constraints).toEqual(["avoid busy backgrounds", "avoid stock-photo people"]);
    const images = await Promise.all(products.map((p) => repo.getProduct(p.id)));
    expect(images.every((p) => p!.images.slice(0, 2).every((i) => i.storage_path))).toBe(true);
  });
});

describe("state summary", () => {
  useFreshDb();
  useMsw();
  it("stays under 400 tokens for a campaign with 30 ads, and mentions canvas events", async () => {
    const c = await newCampaign();
    await postChat(c.id, [userMsg("Make ads for www.loopycases.com")]);
    const brand = (await repo.getBrandByDomain("loopycases.com"))!;
    const p = (await repo.listProducts(brand.id)).find((x) => x.images.length)!;
    await confirmBrandKit(c.id, brand.id, { name: "Loopy", colors: ["#8FE8B3"], font: "Exo 2", voice: "playful", audience: "phone people", product_ids: [p.id], goal: "Holiday gifting", tone_words: [] });
    await repo.insertAds(
      c.id,
      Array.from({ length: 30 }, (_, i) => ({ product_id: p.id, product_image_id: p.images[0].id, angle: "gift" as const, headline: `Never drop your phone again ${i}`, cta: "Shop now", layout: "split" as const, scene_prompt: "x" })),
    );
    for (let i = 0; i < 6; i++) await repo.mergeConstraints(c.id, [`constraint number ${i} about something specific`]);
    await repo.insertFeedback({ campaign_id: c.id, text: "ad 3 headline too generic ".repeat(10) });
    await repo.insertEvent(c.id, "ad_copy_edited", { adNumber: 3, fields: { headline: "x" } });
    const s = await buildStateSummary(c.id);
    expect(approxTokens(s)).toBeLessThan(400);
    expect(s).toContain("Ads: 30 total");
    expect(s).toContain("user edited ad #3 headline");
  });
});

describe("HITL resume", () => {
  useFreshDb();
  useMsw();
  it("resuming with a confirmBrandKit tool result continues to planConcepts and generateAds", async () => {
    const c = await newCampaign();
    const m1 = userMsg("Make ads for www.loopycases.com");
    const r1 = await postChat(c.id, [m1]);
    const a1 = assistantFrom(r1.chunks);
    const brand = (await repo.getBrandByDomain("loopycases.com"))!;
    const heroIds = (brand.source as unknown as { hero_product_ids: string[] }).hero_product_ids;
    const result = await confirmBrandKit(c.id, brand.id, { name: "Loopy", colors: ["#8FE8B3"], font: "Exo 2", voice: "playful", audience: "phone people", product_ids: heroIds.slice(0, 2), goal: "Holiday gifting", tone_words: [] });
    const part = a1.parts.find((p) => p.type === "tool-confirmBrandKit") as unknown as Record<string, unknown>;
    Object.assign(part, { state: "output-available", output: { ok: true, ...result } });
    const r2 = await postChat(c.id, [m1, a1]);
    expect(r2.res.status).toBe(200);
    expect(r2.chunks.some((x) => x.type === "error")).toBe(false);
    expect(toolCalls(r2.chunks)).toEqual(["planConcepts", "generateAds"]);
    expect(text(r2.chunks)).toMatch(/6 ads are ready on the canvas/);
    expect(r2.chunks.some((x) => x.type === "data-progress" && /Rendered ad 6\/6/.test(String((x.data as { message: string }).message)))).toBe(true);
    const ads = await repo.listAds(c.id);
    expect(ads).toHaveLength(6);
    expect(ads.every((a) => a.current_variant_id)).toBe(true);
  });
});
