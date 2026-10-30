import { expect, test } from "@playwright/test";
import { canvas, cards, flags, onboard, readyImages, remote, resetFlags, waitForReady } from "./helpers";

test.beforeEach(async ({ request }) => resetFlags(request));

test("Loopy → 6 ads → edit headline → feedback regenerate → approve 3", async ({ page }) => {
  await onboard(page);

  // Skeletons first, then 6 ready ads whose images are real 1080×1920 PNGs.
  await expect(canvas(page).getByTestId("skeleton").first()).toBeVisible();
  await waitForReady(page, 6);
  const sizes = await readyImages(page).evaluateAll((imgs) => (imgs as HTMLImageElement[]).map((i) => [i.complete, i.naturalWidth, i.naturalHeight]));
  expect(sizes).toEqual(Array(6).fill([true, 1080, 1920]));
  await expect(page.getByText(/6 ads are ready on the canvas/)).toBeVisible();

  // Edit a headline in the drawer: the image updates and history shows 2 versions.
  await page.getByRole("button", { name: "Open ad #1" }).click();
  const drawer = page.getByRole("dialog", { name: "Ad #1 details" });
  const before = await drawer.getByTestId("detail-image").getAttribute("src");
  await drawer.getByLabel("Headline (≤ 6 words)").fill("Hold on tight");
  await drawer.getByRole("button", { name: "Update copy" }).click();
  await expect(drawer.getByTestId("detail-image")).not.toHaveAttribute("src", before!);
  await expect(drawer.getByTestId("variant")).toHaveCount(2);

  // Feedback + regenerate: a third version appears.
  await drawer.getByLabel("Tell the agent what to change").fill("darker, more premium, no props");
  await drawer.getByRole("button", { name: "Regenerate" }).click();
  await expect(drawer.getByText("New version created")).toBeVisible();
  await expect(drawer.getByTestId("variant")).toHaveCount(3);
  await drawer.getByRole("button", { name: "Close" }).click();

  // Approve 3 ads; the Approved tab shows 3.
  for (const n of [1, 2, 3]) {
    const card = canvas(page).getByRole("article", { name: `Ad #${n}`, exact: true });
    await card.hover();
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toHaveAttribute("data-status", "approved");
  }
  await canvas(page).getByRole("tab", { name: /approved/i }).click();
  await expect(cards(page)).toHaveCount(3);

  // Survives a reload: everything comes back from Postgres.
  await page.reload();
  await canvas(page).getByRole("tab", { name: /approved/i }).click();
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByText(/6 ads are ready on the canvas/)).toBeVisible();
});

test("campaign feedback in chat visibly changes the next generation", async ({ page }) => {
  await onboard(page);
  await waitForReady(page, 6);
  const scenePrompt = async () => (await page.request.get(page.url().replace("/c/", "/api/campaigns/"))).json();
  await page.getByLabel("Message").fill("Make it more premium and avoid busy backgrounds");
  await page.getByRole("button", { name: "Send" }).click();
  await waitForReady(page, 9);
  const view = await scenePrompt();
  const newest = view.ads.slice(-3);
  expect(view.campaign.constraints).toContain("Make it more premium and avoid busy backgrounds");
  for (const a of newest) expect(a.current.status).toBe("ready");
  // The new scenes are rendered from a prompt carrying the rule (dark premium palette in the mock model).
  const dark = await page.evaluate(async (url) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 70;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 40, 70);
    const d = ctx.getImageData(0, 30, 40, 10).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) / 3;
  }, newest[0].current.scene_url);
  expect(dark).toBeLessThan(110);
});

test("reload mid-generation: completed ads persist and the rest finish", async ({ page, request }) => {
  test.skip(remote, "needs runtime test hooks");
  await flags(request, { MOCK_IMAGE_DELAY_MS: "2500" });
  await onboard(page);
  await expect(readyImages(page).first()).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await waitForReady(page, 6);
});

test("image failure shows a fallback ad with a retry button, not a broken card", async ({ page, request }) => {
  test.skip(remote, "needs runtime test hooks");
  await flags(request, { MOCK_IMAGE_FAIL: "1" });
  await onboard(page);
  await waitForReady(page, 6);
  const first = canvas(page).getByRole("article", { name: "Ad #1", exact: true });
  await expect(first.getByText("Product-photo fallback")).toBeVisible();
  await expect(first.getByRole("button", { name: "Retry" })).toBeVisible();
  await flags(request, { MOCK_IMAGE_FAIL: null });
  await first.getByRole("button", { name: "Retry" }).click();
  await expect(first.getByText("Product-photo fallback")).toHaveCount(0, { timeout: 30_000 });
});

test("approving a warn ad asks for confirmation; a pass ad doesn't", async ({ page, request }) => {
  test.skip(remote, "needs runtime test hooks");
  await flags(request, { QA_MODE: "full", MOCK_QA_SCRIPT: "warn,pass" });
  await onboard(page);
  await waitForReady(page, 6);
  const warn = canvas(page).getByRole("article").filter({ hasText: "QA: check" }).first();
  await warn.hover();
  await warn.getByRole("button", { name: "Approve" }).click();
  await expect(warn.getByRole("alertdialog", { name: "Confirm approval" })).toBeVisible();
  await warn.getByRole("button", { name: "Approve anyway" }).click();
  await expect(warn).toHaveAttribute("data-status", "approved");

  const pass = canvas(page).getByRole("article").filter({ hasText: "QA pass" }).first();
  await pass.hover();
  await pass.getByRole("button", { name: "Approve" }).click();
  await expect(pass).toHaveAttribute("data-status", "approved");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("mobile viewport: tabs switch between chat and canvas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page);
  await page.getByRole("tab", { name: /^Ads/ }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Chat" })).toBeHidden();
  await waitForReady(page, 6);
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByRole("region", { name: "Chat" })).toBeVisible();
});
