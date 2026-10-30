"use client";

import { useState } from "react";
import type { ProgressData } from "@/lib/agent/tools";
import { Shimmer } from "@/components/ai-elements/shimmer";

/** Tool parts across all tools (the typed union gets in the way for shared rendering). */
export type LooseToolPart = { type: string; toolCallId: string; state: string; input?: unknown; output?: unknown; errorText?: string };

const LABELS: Record<string, string> = {
  researchStore: "Researching store",
  confirmBrandKit: "Brand kit",
  planConcepts: "Planning concepts",
  generateAds: "Generating ads",
  regenerateAd: "Regenerating ad",
  editAdCopy: "Editing copy",
  setAdStatus: "Updating status",
  recordFeedback: "Saving feedback",
};

export function ProgressList({ items: all, running }: { items: ProgressData[]; running: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!all.length && !running) return null;
  const hidden = expanded ? 0 : Math.max(0, all.length - 4);
  const items = all.slice(hidden);
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Progress">
      {hidden > 0 && (
        <li>
          <button className="underline-offset-2 hover:underline" onClick={() => setExpanded(true)}>
            {hidden} earlier steps
          </button>
        </li>
      )}
      {items.map((p, i) => (
        <li key={i} className="flex gap-1.5">
          <span aria-hidden>{i === items.length - 1 && running ? "›" : "✓"}</span>
          {i === items.length - 1 && running ? <Shimmer>{p.message}</Shimmer> : p.message}
        </li>
      ))}
      {!items.length && running && (
        <li>
          <Shimmer>Working…</Shimmer>
        </li>
      )}
    </ul>
  );
}

function Fail({ output }: { output: { error?: unknown } }) {
  return <p className="text-xs text-amber-800">{String(output.error ?? "Failed")}</p>;
}

export function ToolCard({ part, progress, children }: { part: LooseToolPart; progress: ProgressData[]; children?: React.ReactNode }) {
  const name = part.type.slice(5);
  const running = part.state === "input-streaming" || part.state === "input-available";
  const output = part.state === "output-available" ? (part.output as Record<string, unknown>) : null;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-tool={name} data-state={part.state}>
      <div className="flex items-center justify-between text-xs font-medium">
        <span>{LABELS[name] ?? name}</span>
        <span className="text-muted-foreground">{running ? "running" : output?.ok === false ? "needs attention" : part.state === "output-error" ? "error" : "done"}</span>
      </div>
      {name !== "confirmBrandKit" && <ProgressList items={progress} running={running} />}
      {output?.ok === false && <Fail output={output} />}
      {part.state === "output-error" && <p className="text-xs text-destructive">{part.errorText}</p>}
      {children}
    </div>
  );
}

export function ResearchSummary({ output }: { output: Record<string, unknown> }) {
  if (output.ok === false) return null;
  const kit = output.kit as { colors: string[]; voice: string | null; logo_url: string | null };
  const counts = output.counts as { products: number };
  return (
    <div className="flex items-center gap-3 text-xs">
      {kit.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={kit.logo_url} alt="" className="h-8 max-w-20 rounded bg-background object-contain p-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{String(output.name)}</div>
        <div className="text-muted-foreground">
          {counts.products} products · {kit.voice}
        </div>
      </div>
      <div className="flex gap-1">
        {kit.colors.slice(0, 4).map((c) => (
          <span key={c} title={c} className="h-5 w-5 rounded-full border" style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

export function ConfirmedKit({ output }: { output: Record<string, unknown> }) {
  if (output.ok === false) return <p className="text-xs text-muted-foreground">Not confirmed.</p>;
  const products = (output.products as { title: string }[]) ?? [];
  return (
    <p className="text-xs text-muted-foreground">
      Confirmed · {String(output.font)} · {products.map((p) => p.title).join(", ")} · {String(output.goal)}
    </p>
  );
}
