import { UrlForm } from "@/components/home/url-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-4 py-16">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">AI Ads Manager</h1>
        <p className="text-muted-foreground">
          We&apos;ll read your store, draft a brand kit for you to check, then make 9:16 ads from your real product photos.
        </p>
      </div>
      <UrlForm />
    </main>
  );
}
