// pnpm smoke:live — the only test that spends money: research + 1 concept + 1 image (+1 vision QA) on Loopy Cases.
// Refuses without ALLOW_LIVE=1 and hard-stops after 1 image call. Outputs go to runs/<date>/smoke/.
import { config } from "dotenv";
config({ path: ".env.local" });
import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  if (process.env.ALLOW_LIVE !== "1") {
    console.error("Refusing to run: this spends real money. Re-run with ALLOW_LIVE=1 pnpm smoke:live");
    process.exit(2);
  }
  process.env.AI_MODE = "live";
  process.env.QA_MODE ??= "full";
  process.env.LIVE_IMAGE_CALL_LIMIT = "1";
  const url = process.argv[2] ?? "https://www.loopycases.com";
  const { checkEnv } = await import("../lib/env");
  const envCheck = checkEnv();
  if (!envCheck.ok) throw new Error(`missing env: ${envCheck.missing.join(", ")}`);

  const repo = await import("../lib/db/repo");
  const { researchStore } = await import("../lib/agent/tools/research-store");
  const { confirmBrandKit } = await import("../lib/campaign/brand-kit");
  const { planConcepts, generateAds } = await import("../lib/agent/tools/generation");
  const { download } = await import("../lib/storage");
  const log = (m: string) => console.log(`  · ${m}`);
  const dir = `runs/${new Date().toISOString().slice(0, 10)}/smoke`;
  await mkdir(dir, { recursive: true });

  const campaign = await repo.createCampaign(url, `smoke ${new Date().toISOString()}`);
  const ctx = { campaignId: campaign.id, progress: log };
  const research = await researchStore({ url, force: true }, ctx);
  if (!research.ok) throw new Error(`research failed: ${research.error}`);
  console.log(`research: ${research.name}, ${research.counts.products} products, colors ${research.kit.colors.join(" ")}`);
  const hero = research.hero_products[0];
  await confirmBrandKit(campaign.id, research.brandId, {
    name: research.name ?? "Brand",
    colors: research.kit.colors.slice(0, 3),
    font: research.kit.fonts[0] ?? "Inter",
    voice: research.kit.voice ?? "friendly",
    audience: research.kit.audience ?? "shoppers",
    product_ids: [hero.id],
    goal: "Holiday gifting",
    tone_words: research.kit.tone_words,
  });
  const plan = await planConcepts({ campaignId: campaign.id, count: 1 }, ctx);
  if (!plan.ok) throw new Error(`plan failed: ${plan.error}`);
  console.log(`concept: ${JSON.stringify(plan.ads[0])}`);
  const gen = await generateAds({ campaignId: campaign.id }, ctx);
  if (!gen.ok) throw new Error(`generate failed: ${gen.error}`);
  const [ad] = await repo.listAds(campaign.id);
  const v = (await repo.getVariant(ad.current_variant_id!))!;
  await writeFile(`${dir}/final.png`, await download(v.final_path!));
  await writeFile(`${dir}/scene.png`, await download(v.scene_path!));
  await writeFile(`${dir}/result.json`, JSON.stringify({ research, plan, gen, variant: { model: v.model, qa_status: v.qa_status, qa: v.qa, prompt: v.prompt } }, null, 2));
  console.log(`\nimage: model=${v.model} qa_status=${v.qa_status} fallback=${v.model === "fallback"}`);
  console.log(`saved ${dir}/final.png, scene.png, result.json · campaign /c/${campaign.id}`);
  if (v.model === "fallback") process.exitCode = 1;
  process.exit(process.exitCode ?? 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
