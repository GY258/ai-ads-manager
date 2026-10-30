"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const EXAMPLES = ["www.loopycases.com", "www.allbirds.com", "www.ridgewallet.com"];

export function UrlForm() {
  const [url, setUrl] = useState("");
  return (
    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
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
          className="h-10 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" className="h-10">
          Make ads
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setUrl(ex)} className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted">
            {ex}
          </button>
        ))}
      </div>
    </form>
  );
}
