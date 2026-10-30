"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { startCampaign, type UrlFormState } from "@/app/actions/campaign";

const EXAMPLES = ["www.loopycases.com", "www.allbirds.com", "www.ridgewallet.com"];

export function UrlForm() {
  const [state, action, pending] = useActionState<UrlFormState, FormData>(startCampaign, {});
  const [url, setUrl] = useState(state.url ?? "");
  return (
    <form className="space-y-3" action={action}>
      <label htmlFor="store-url" className="text-sm font-medium">
        Store URL
      </label>
      <div className="flex gap-2">
        <input
          id="store-url"
          name="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="www.loopycases.com"
          aria-invalid={!!state.error}
          aria-describedby={state.error ? "store-url-error" : undefined}
          className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
        />
        <Button type="submit" className="h-10" disabled={pending || !url.trim()}>
          {pending ? "Checking…" : "Make ads"}
        </Button>
      </div>
      {state.error && (
        <p id="store-url-error" role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2" aria-label="Example stores">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setUrl(ex)} className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted">
            {ex}
          </button>
        ))}
      </div>
    </form>
  );
}
