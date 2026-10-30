import Link from "next/link";
import { UrlForm } from "@/components/home/url-form";
import { listCampaigns } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export default async function Home() {
  const past = await listCampaigns().catch(() => []);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-10 px-4 py-16">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">AI Ads Manager</h1>
        <p className="text-muted-foreground">
          We&apos;ll read your store, draft a brand kit for you to check, then make 9:16 ads from your real product photos.
        </p>
      </div>
      <UrlForm />
      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Recent campaigns</h2>
          <ul className="divide-y rounded-md border">
            {past.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.id}`} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted">
                  <span className="truncate">{c.brand_name ?? c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.ad_count} ads</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
