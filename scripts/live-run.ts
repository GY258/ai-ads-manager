// Drives the deployed app in a real browser through the definition of done. Screenshots → runs/<date>/live/.
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE ?? "https://ai-ads-manager-eight.vercel.app";
const STORE = process.argv[2] ?? "www.loopycases.com";
const ADS_FIRST = Number(process.env.ADS_FIRST ?? "6");
const FEEDBACK = process.env.FEEDBACK ?? "Make it more premium: darker background, minimal props.";
const DIR = `runs/${new Date().toISOString().slice(0, 10)}/live/${STORE.replace(/^www\./, "").split(".")[0]}`;
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const shot = (p: Page, n: string) => p.screenshot({ path: `${DIR}/${n}.png` });

async function ready(p: Page) {
  return p.locator('section[aria-label="Creative canvas"] article img[alt^="Ad #"]').count();
}
async function waitReady(p: Page, n: number, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const c = await ready(p);
    const busy = await p.getByTestId("skeleton").count();
    if (c >= n && busy === 0) return c;
    await p.waitForTimeout(3000);
  }
  return ready(p);
}

async function main() {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(DIR, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(BASE);
  await p.getByLabel("Store URL").fill(STORE);
  await p.getByRole("button", { name: "Make ads" }).click();
  await p.waitForURL(/\/c\//, { timeout: 30_000 });
  log(`campaign ${p.url()}`);
  const form = p.getByRole("form", { name: "Brand kit" });
  await form.waitFor({ timeout: 180_000 });
  log("brand kit form shown");
  await shot(p, "1-brand-kit");
  const picked = form.getByRole("button", { pressed: true });
  while ((await picked.count()) > 2) await picked.last().click();
  await form.getByRole("button", { name: "Confirm brand kit" }).click();
  log("confirmed; waiting for ads");
  const n1 = await waitReady(p, ADS_FIRST, 420_000);
  log(`${n1} ads ready`);
  await shot(p, "2-first-round");

  const approveN = Math.min(3, n1);
  for (let i = 1; i <= approveN; i++) {
    const card = p.getByRole("article", { name: `Ad #${i}`, exact: true });
    await card.hover();
    await card.getByRole("button", { name: "Approve" }).click();
    const confirm = card.getByRole("button", { name: "Approve anyway" });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await p.waitForTimeout(800);
  }
  log(`approved ${approveN}`);

  await p.getByLabel("Message").fill(FEEDBACK);
  await p.getByRole("button", { name: "Send" }).click();
  log("feedback sent");
  const n2 = await waitReady(p, n1 + 1, 420_000);
  log(`${n2} ads ready after feedback`);
  await p.waitForTimeout(4000);
  await shot(p, "3-after-feedback");

  await p.reload();
  await p.waitForTimeout(5000);
  const approved = await p.locator('article[data-status="approved"]').count();
  log(`after reload: ${await ready(p)} ready, ${approved} approved`);
  await shot(p, "4-after-reload");
  const chat = await p.getByRole("region", { name: "Chat" }).innerText();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`${DIR}/chat.txt`, chat);
  await b.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
