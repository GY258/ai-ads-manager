import Link from "next/link";
import { UrlForm } from "@/components/home/url-form";
import { listCampaigns } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Read", body: "We pull your products, photos, colors and voice straight from your store. No uploads, no forms." },
  { title: "Check", body: "You review a drafted brand kit and the ad concepts before anything is generated. Nothing ships without you." },
  { title: "Create", body: "Real product photos become 9:16 scenes. Headlines are typeset by us, so spelling and fonts are always right." },
];

export default async function Home() {
  const past = await listCampaigns().catch(() => []);
  return (
    <div className="flex min-h-dvh flex-col gap-4 pb-8">
      <header className="flex items-center justify-between px-6 py-5 sm:px-12">
        <span className="display text-2xl">AI Ads Manager</span>
        <nav className="flex items-center gap-2 text-sm">
          {past.length > 0 && (
            <a href="#recent" className="rounded-full bg-white px-4 py-2.5 font-medium">
              Recent
            </a>
          )}
          <a href="#start" className="rounded-full bg-primary px-5 py-2.5 font-medium text-primary-foreground">
            Start free
          </a>
        </nav>
      </header>

      <main className="flex flex-col gap-4 px-3 sm:px-8">
        <section id="start" className="panel-hero flex flex-col items-center gap-8 rounded-3xl px-6 py-16 text-center sm:py-24">
          <h1 className="display max-w-5xl text-[13vw] text-foreground sm:text-7xl lg:text-8xl">Turn any store into ads that sell.</h1>
          <p className="max-w-md text-base text-foreground/80">
            We&apos;ll read your store, draft a brand kit for you to check, then make 9:16 ads from your real product photos.
          </p>
          <UrlForm />
        </section>

        <section className="grid gap-px overflow-hidden rounded-3xl bg-border sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="space-y-2 bg-white p-8">
              <div className="text-xs font-medium text-muted-foreground">0{i + 1}</div>
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </section>

        {past.length > 0 && (
          <section id="recent" className="rounded-3xl bg-[var(--panel-yellow)] p-6 sm:p-10">
            <h2 className="display mb-6 text-4xl sm:text-5xl">Pick up where you left off</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {past.slice(0, 9).map((c) => (
                <li key={c.id}>
                  <Link href={`/c/${c.id}`} className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 text-sm transition hover:-translate-y-0.5">
                    <span className="truncate font-medium">{c.brand_name ?? c.name}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs">{c.ad_count} ads</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
