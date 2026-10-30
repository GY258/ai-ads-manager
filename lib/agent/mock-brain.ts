import type { LanguageModelV4Prompt } from "@ai-sdk/provider";

export type MockPart = { type: "text"; text: string } | { type: "tool-call"; toolName: string; input: unknown };

type ToolResult = { toolName: string; value: Record<string, unknown> };

const text = (t: string): MockPart => ({ type: "text", text: t });
const call = (toolName: string, input: unknown): MockPart => ({ type: "tool-call", toolName, input });

function lastToolResult(prompt: LanguageModelV4Prompt): ToolResult | null {
  const last = prompt.at(-1);
  if (last?.role !== "tool") return null;
  const part = last.content.findLast((p) => p.type === "tool-result");
  if (!part || part.type !== "tool-result") return null;
  const out = part.output as { type: string; value: unknown };
  const value = (out.type === "json" ? out.value : out.type === "text" ? safeJson(out.value as string) : { ok: false, error: String(out.value) }) as Record<string, unknown>;
  return { toolName: part.toolName, value: value ?? {} };
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return { ok: false, error: s };
  }
};

function lastUserText(prompt: LanguageModelV4Prompt): string {
  const last = prompt.at(-1);
  if (last?.role !== "user") return "";
  return last.content.map((p) => (p.type === "text" ? p.text : "")).join(" ");
}

const FALLBACK_TEXT: Record<string, string> = {
  ask_for_valid_url: "Could you paste a working store URL? For example: www.loopycases.com",
  ask_for_product_urls_or_upload: "Can you paste a few product page URLs, or upload product photos, so I have real products to work with?",
  shorten_copy: "Here are 3 shorter options: \"Grip it.\" · \"Never drop it\" · \"Hold on tight\". Want me to use one?",
  product_hero_template: "I used your real product photo on a brand-color background instead. Want me to retry the scene?",
  confirm_brand_kit_first: "Let's confirm your brand kit first.",
  retry: "Want me to try again?",
};

/**
 * Rule-based stand-in for the chat model in AI_MODE=mock. It reads the same prompt the real model gets
 * (system prompt with state summary + messages) and plays the spec's flow, so the whole app runs without paid calls.
 */
export function mockAgentTurn(prompt: LanguageModelV4Prompt, tools: string[] = []): MockPart[] {
  const has = (t: string) => tools.length === 0 || tools.includes(t);
  const system = prompt.find((m) => m.role === "system")?.content ?? "";
  const campaignId = (typeof system === "string" ? system : "").match(/Campaign id: ([0-9a-f-]{36})/)?.[1] ?? "";

  const r = lastToolResult(prompt);
  if (r) {
    const v = r.value;
    if (v.ok === false) {
      const fb = FALLBACK_TEXT[String(v.fallback)] ?? FALLBACK_TEXT.retry;
      return [text(`${String(v.error ?? "That didn't work.").split("\n")[0]} ${fb}`)];
    }
    switch (r.toolName) {
      case "researchStore": {
        const counts = v.counts as { products: number };
        return [text(`I read ${v.name}: ${counts.products} products. Check the brand kit below — edit anything that looks off, pick 1–3 products, and confirm.`), call("confirmBrandKit", { brandId: v.brandId })];
      }
      case "confirmBrandKit":
        return has("planConcepts") ? [text("Brand kit confirmed. Planning concepts across different angles…"), call("planConcepts", { campaignId, count: 6 })] : [text("Brand kit confirmed.")];
      case "planConcepts":
        return has("reviewConcepts")
          ? [text(`Here are ${(v.ads as unknown[]).length} concepts. Edit or remove any, then approve to generate.`), call("reviewConcepts", { adIds: (v.ads as { id: string }[]).map((a) => a.id) })]
          : [text("Concepts planned.")];
      case "reviewConcepts": {
        const approved = (v.approved as { id: string }[] | undefined) ?? [];
        return approved.length && has("generateAds") ? [call("generateAds", { campaignId, adIds: approved.map((a) => a.id) })] : [text("No concepts approved — tell me what to plan instead.")];
      }
      case "generateAds": {
        const s = v.summary as { ready: number; fallback: number; failed: number } | undefined;
        const fb = s?.fallback ? ` ${s.fallback} used the product-photo fallback — hit retry on those to try the scene again.` : "";
        return [text(`${s?.ready ?? 0} ads are ready on the canvas.${fb} Approve the ones you like, or tell me what to change.`)];
      }
      case "recordFeedback":
        return has("planConcepts") ? [text("Got it — I'll apply that to the next round. Planning 3 new concepts…"), call("planConcepts", { campaignId, count: 3 })] : [text("Noted.")];
      case "regenerateAd":
        return [text(`Done — ad #${v.adNumber} has a new version on the canvas.`)];
      case "editAdCopy":
        return [text(`Updated ad #${v.adNumber}.`)];
      case "setAdStatus":
        return [text(`Ad #${v.adNumber} is now ${v.status}.`)];
      default:
        return [text("Done.")];
    }
  }

  const user = lastUserText(prompt);
  const url = user.match(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?)/i)?.[1];
  const adRef = user.match(/\b(?:ad|#)\s*#?(\d{1,3})\b/i)?.[1];
  if (url && !adRef && has("researchStore")) return [text("On it — reading the store."), call("researchStore", { url })];
  if (adRef && /\bapprove\b/i.test(user) && has("setAdStatus")) return [call("setAdStatus", { adId: adRef, status: "approved" })];
  if (adRef && /\breject\b/i.test(user) && has("setAdStatus")) return [call("setAdStatus", { adId: adRef, status: "rejected" })];
  const exactHeadline = user.match(/headline\s*(?:to|:)\s*["“]([^"”]+)["”]/i)?.[1];
  if (adRef && exactHeadline && has("editAdCopy")) return [call("editAdCopy", { adId: adRef, headline: exactHeadline })];
  if (adRef && has("regenerateAd")) {
    const scope = /\b(headline|copy|text|cta|wording)\b/i.test(user) ? "copy" : "both";
    return [text(`Changing ad #${adRef}: ${user.replace(/.*?ad\s*#?\d+\s*[:,-]?\s*/i, "").slice(0, 80)}.`), call("regenerateAd", { adId: adRef, feedback: user, scope })];
  }
  if (/\b(more|less|avoid|make|prefer|don'?t|no)\b/i.test(user) && has("recordFeedback")) {
    return [call("recordFeedback", { campaignId, text: user, constraints: [user.trim().replace(/[.!]+$/, "")] })];
  }
  if (/\b(generate|more ads|again)\b/i.test(user) && has("planConcepts")) return [call("planConcepts", { campaignId, count: 3 })];
  return [text("Hi! I'm running in mock mode. Paste a store URL to get started.")];
}
