export type BrandStatus = "researching" | "draft" | "confirmed" | "failed";
export type AdStatus = "draft" | "approved" | "rejected";
export type VariantStatus = "queued" | "generating_scene" | "composing" | "ready" | "failed";

const TRANSITIONS = {
  brand: {
    researching: ["draft", "failed"],
    draft: ["confirmed", "researching", "failed"],
    confirmed: ["researching", "draft"],
    failed: ["researching"],
  },
  ad: {
    draft: ["approved", "rejected"],
    approved: ["draft", "rejected"],
    rejected: ["draft", "approved"],
  },
  variant: {
    queued: ["generating_scene", "composing", "failed"],
    generating_scene: ["generating_scene", "composing", "failed"],
    composing: ["ready", "failed"],
    ready: [],
    failed: [],
  },
} as const;

type Kind = keyof typeof TRANSITIONS;
type StatusOf<K extends Kind> = keyof (typeof TRANSITIONS)[K] & string;

export class TransitionError extends Error {}

export function canTransition<K extends Kind>(kind: K, from: StatusOf<K>, to: StatusOf<K>): boolean {
  if (from === to && kind !== "variant") return true;
  const allowed = (TRANSITIONS[kind] as Record<string, readonly string[]>)[from] ?? [];
  return allowed.includes(to);
}

export function assertTransition<K extends Kind>(kind: K, from: StatusOf<K>, to: StatusOf<K>) {
  if (!canTransition(kind, from, to)) throw new TransitionError(`${kind}: ${from} → ${to} not allowed`);
}
