import { z } from "zod";
import { structured } from "@/lib/adapters/llm";
import { COPY_LIMITS } from "@/lib/agent/schemas";
import type { Ad } from "@/lib/db/types";

export const rewriteCopySchema = z.object({ headline: z.string(), subhead: z.string().nullable(), cta: z.string() });
const clamp = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(" ");

const ALT: Record<string, string[]> = {
  gift: ["Wrap up a better grip", "The gift that never drops"],
  lifestyle: ["Your hand, upgraded", "One loop, zero fumbles"],
  social_proof: ["Rated 4.8 by droppers", "70,000 hands can't be wrong"],
  problem_solution: ["Drop-proof starts here", "Stop dropping. Start looping."],
  feature: ["Loop. Grip. Go.", "Swap loops in seconds"],
  offer: ["Today only: better grip", "Grip more, pay less"],
};

/** Small LLM call: rewrite one ad's copy to apply feedback, within the copy limits. */
export async function rewriteCopy(ad: Pick<Ad, "angle" | "headline" | "subhead" | "cta">, feedback: string, brandVoice: string | null) {
  const r = await structured({
    role: "subagent",
    name: "rewrite-copy",
    schema: rewriteCopySchema,
    instructions: `Rewrite ad copy to apply the feedback. Voice: ${brandVoice ?? "on-brand"}. Headline ≤ ${COPY_LIMITS.headline} words, subhead ≤ ${COPY_LIMITS.subhead} words, CTA ≤ ${COPY_LIMITS.cta} words. Specific beats generic.`,
    prompt: `Angle: ${ad.angle}\nCurrent headline: ${ad.headline}\nCurrent subhead: ${ad.subhead ?? ""}\nCurrent CTA: ${ad.cta}\nFeedback: ${feedback}`,
    mock: () => {
      const quoted = feedback.match(/["“]([^"”]{2,60})["”]/)?.[1];
      const options = (ALT[ad.angle] ?? ALT.feature).filter((h) => h !== ad.headline);
      const shorter = /short|concise|tighter/i.test(feedback);
      const headline = quoted ?? (shorter ? ad.headline.split(/\s+/).slice(0, 3).join(" ") : options[0]);
      return { headline, subhead: ad.subhead, cta: /cta|button/i.test(feedback) ? "Get yours" : ad.cta };
    },
  });
  const o = r.object;
  return { copy: { headline: clamp(o.headline, COPY_LIMITS.headline), subhead: o.subhead ? clamp(o.subhead, COPY_LIMITS.subhead) : null, cta: clamp(o.cta, COPY_LIMITS.cta) }, modelCalls: r.modelCalls };
}
