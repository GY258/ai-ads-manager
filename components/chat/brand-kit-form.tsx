"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadBrandKit, submitBrandKit, type ConfirmResult } from "@/app/actions/campaign";
import type { BrandKitData } from "@/lib/campaign/brand-kit";
import { FONTS, closestFont } from "@/lib/compose/font-catalog";

const GOALS = ["Holiday gifting", "New arrivals", "Best sellers", "Sale / promotion", "Brand awareness"];

function CheckBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">please check</span>;
}

export function BrandKitForm({ campaignId, brandId, onConfirmed }: { campaignId: string; brandId: string; onConfirmed: (r: Extract<ConfirmResult, { ok: true }>["result"]) => void }) {
  const [data, setData] = useState<BrandKitData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    loadBrandKit(brandId).then(setData, (e) => setLoadError(String(e.message ?? e)));
  }, [brandId]);
  if (loadError) return <p className="text-sm text-destructive">Couldn&apos;t load the brand kit: {loadError}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading brand kit…</p>;
  return <Form campaignId={campaignId} data={data} onConfirmed={onConfirmed} />;
}

function Form({ campaignId, data, onConfirmed }: { campaignId: string; data: BrandKitData; onConfirmed: (r: Extract<ConfirmResult, { ok: true }>["result"]) => void }) {
  const { brand } = data;
  const src = brand.source as Record<string, string>;
  const unsure = (k: string) => src[k] === "inferred" || src[k] === "fallback";
  const [name, setName] = useState(brand.name);
  const [colors, setColors] = useState<string[]>(brand.colors.length ? brand.colors.slice(0, 3) : ["#111111"]);
  const [font, setFont] = useState<string>(closestFont(brand.fonts[0]));
  const [voice, setVoice] = useState(brand.voice);
  const [audience, setAudience] = useState(brand.audience);
  const [selected, setSelected] = useState<string[]>(data.heroIds.filter((id) => data.products.some((p) => p.id === id)).slice(0, 3));
  const [goal, setGoal] = useState(GOALS[0]);
  const [goalNote, setGoalNote] = useState("");
  const [offer, setOffer] = useState("");
  const [avoid, setAvoid] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const fontOptions = useMemo(() => FONTS.map((f) => f.family), []);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? s : [...s, id]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    const r = await submitBrandKit(campaignId, brand.id, {
      name,
      colors,
      font,
      voice,
      audience,
      value_prop: brand.value_prop || undefined,
      tone_words: brand.tone_words,
      product_ids: selected,
      goal: goalNote.trim() ? `${goal}: ${goalNote.trim()}` : goal,
      offer: offer.trim() || undefined,
      avoid: avoid.trim() || undefined,
    });
    setPending(false);
    if (r.ok) onConfirmed(r.result);
    else {
      setErrors(r.fieldErrors ?? {});
      setFormError(r.error);
    }
  }

  const input = "h-9 w-full rounded-xl border bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <form onSubmit={submit} aria-label="Brand kit" className="space-y-4 rounded-2xl bg-white p-4 text-sm">
      <div className="flex items-center gap-3">
        {brand.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo_url} alt={`${brand.name} logo`} className="h-10 max-w-28 rounded bg-muted object-contain p-1" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-xs">logo</div>
        )}
        <div className="flex-1">
          <label htmlFor="kit-name" className="text-xs font-medium text-muted-foreground">
            Brand name<CheckBadge show={unsure("name")} />
          </label>
          <input id="kit-name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-muted-foreground">
          Colors<CheckBadge show={unsure("colors")} />
        </legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {colors.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-md border px-1.5 py-1">
              <input type="color" aria-label={`Color ${i + 1} picker`} value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#000000"} onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0" />
              <input aria-label={`Color ${i + 1} hex`} value={c} onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))} className="w-20 bg-transparent font-mono text-xs outline-none" />
            </div>
          ))}
          {colors.length < 4 && (
            <button type="button" onClick={() => setColors([...colors, "#FFFFFF"])} className="rounded-md border px-2 text-xs text-muted-foreground">
              + add
            </button>
          )}
        </div>
        {errors.colors && <p className="mt-1 text-xs text-destructive">{errors.colors}</p>}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="kit-font" className="text-xs font-medium text-muted-foreground">
            Font<CheckBadge show={unsure("fonts")} />
          </label>
          <select id="kit-font" className={input} value={font} onChange={(e) => setFont(e.target.value)}>
            {fontOptions.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          {brand.fonts[0] && <p className="mt-0.5 text-[11px] text-muted-foreground">Site uses {brand.fonts[0]}</p>}
        </div>
        <div>
          <label htmlFor="kit-voice" className="text-xs font-medium text-muted-foreground">
            Voice<CheckBadge show={unsure("voice")} />
          </label>
          <input id="kit-voice" className={input} value={voice} onChange={(e) => setVoice(e.target.value)} />
        </div>
      </div>
      <div>
        <label htmlFor="kit-audience" className="text-xs font-medium text-muted-foreground">
          Audience<CheckBadge show={unsure("audience")} />
        </label>
        <input id="kit-audience" className={input} value={audience} onChange={(e) => setAudience(e.target.value)} />
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-muted-foreground">
          Products to feature (pick 1–3) · {selected.length} selected<CheckBadge show={unsure("hero_products")} />
        </legend>
        <div className="mt-1 grid max-h-64 grid-cols-4 gap-2 overflow-y-auto pr-1">
          {data.products.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                aria-label={p.title}
                onClick={() => toggle(p.id)}
                className={`group relative overflow-hidden rounded-md border-2 text-left ${on ? "border-primary" : "border-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image_url!} alt="" className="aspect-square w-full bg-muted object-cover" />
                <span className="block truncate px-1 py-0.5 text-[10px]">{p.title}</span>
                {on && <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">✓</span>}
              </button>
            );
          })}
        </div>
        {errors.product_ids && <p className="mt-1 text-xs text-destructive">Pick 1–3 products.</p>}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="kit-goal" className="text-xs font-medium text-muted-foreground">
            Campaign goal
          </label>
          <select id="kit-goal" className={input} value={goal} onChange={(e) => setGoal(e.target.value)}>
            {GOALS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="kit-goal-note" className="text-xs font-medium text-muted-foreground">
            Goal details (optional)
          </label>
          <input id="kit-goal-note" className={input} value={goalNote} onChange={(e) => setGoalNote(e.target.value)} placeholder="e.g. stocking stuffers" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="kit-offer" className="text-xs font-medium text-muted-foreground">
            Offer / discount (optional)
          </label>
          <input id="kit-offer" className={input} value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. 20% off" />
        </div>
        <div>
          <label htmlFor="kit-avoid" className="text-xs font-medium text-muted-foreground">
            Things to avoid (optional)
          </label>
          <input id="kit-avoid" className={input} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="e.g. busy backgrounds" />
        </div>
      </div>

      {formError && (
        <p role="alert" className="text-xs text-destructive">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={pending || selected.length === 0} className="w-full rounded-full">
        {pending ? "Saving…" : "Confirm brand kit"}
      </Button>
    </form>
  );
}
