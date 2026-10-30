"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { startCampaign, type UrlFormState } from "@/app/actions/campaign";

const EXAMPLES = ["www.loopycases.com", "www.allbirds.com", "www.ridgewallet.com"];

export function UrlForm() {
  const [state, action, pending] = useActionState<UrlFormState, FormData>(startCampaign, {});
  const [url, setUrl] = useState(state.url ?? "");
  return (
    <form className="w-full max-w-xl space-y-3" action={action}>
      <label htmlFor="store-url" className="sr-only">
        Store URL
      </label>
      <div className="flex gap-1.5 rounded-full bg-white p-1.5 shadow-sm">
        <input
          id="store-url"
          name="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="www.loopycases.com"
          aria-invalid={!!state.error}
          aria-describedby={state.error ? "store-url-error" : undefined}
          className="h-11 min-w-0 flex-1 rounded-full bg-transparent px-4 text-base outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" className="h-11 rounded-full px-6 text-sm" disabled={pending || !url.trim()}>
          {pending ? "Checking…" : "Make ads"}
        </Button>
      </div>
      {state.error && (
        <p id="store-url-error" role="alert" className="rounded-full bg-white/80 px-4 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2" aria-label="Example stores">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setUrl(ex)} className="rounded-full border border-foreground/15 bg-white/60 px-3.5 py-1.5 text-xs font-medium hover:bg-white">
            {ex}
          </button>
        ))}
      </div>
    </form>
  );
}
