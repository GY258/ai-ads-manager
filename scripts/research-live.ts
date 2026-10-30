// pnpm tsx scripts/research-live.ts [url] — one real research run (AI_MODE=replay: cached after the first call).
import { config } from "dotenv";
config({ path: ".env.local" });
process.env.AI_MODE ??= "replay";
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  const url = process.argv[2] ?? "https://www.loopycases.com";
  const repo = await import("../lib/db/repo");
  const { researchStore } = await import("../lib/agent/tools/research-store");
  const c = await repo.createCampaign(url, `research-live ${new Date().toISOString()}`);
  const t = Date.now();
  const r = await researchStore({ url, force: true }, { campaignId: c.id, progress: (m) => console.log("  ·", m) });
  const dir = `runs/${new Date().toISOString().slice(0, 10)}`;
  await mkdir(dir, { recursive: true });
  const file = `${dir}/research-${new URL(url.startsWith("http") ? url : `https://${url}`).hostname}.json`;
  await writeFile(file, JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2).slice(0, 2500));
  console.log(`\n${Date.now() - t}ms → ${file}`);
  const { getDb } = await import("../lib/db/client");
  console.log("model_cache rows:", (await (await getDb()).query("select count(*)::int as n from model_cache"))[0]);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
