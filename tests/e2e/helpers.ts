import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const remote = !!process.env.E2E_BASE_URL;

export async function flags(request: APIRequestContext, f: Record<string, string | null>) {
  const res = await request.post("/api/test/flags", { data: f });
  expect(res.ok()).toBe(true);
}

export async function resetFlags(request: APIRequestContext) {
  if (!remote) await flags(request, { MOCK_IMAGE_FAIL: null, MOCK_IMAGE_DELAY_MS: "400", QA_MODE: null, MOCK_QA_SCRIPT: null, MOCK_FIRECRAWL_FAIL: null });
}

/** Home → Loopy → brand kit → confirm with 2 products. Returns once generation has started. */
export async function onboard(page: Page) {
  await page.goto("/");
  await page.getByLabel("Store URL").fill("www.loopycases.com");
  await page.getByRole("button", { name: "Make ads" }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}$/);
  const form = page.getByRole("form", { name: "Brand kit" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByRole("button", { pressed: true }).first().click();
  await form.getByRole("button", { name: "Confirm brand kit" }).click();
  await expect(page.getByText(/^Confirmed ·/)).toBeVisible();
  await approveConcepts(page);
}

/** HITL: approve whatever concepts the agent planned (optionally editing the first headline). */
export async function approveConcepts(page: Page, firstHeadline?: string) {
  const form = page.getByRole("form", { name: "Review concepts" }).last();
  await expect(form).toBeVisible({ timeout: 30_000 });
  if (firstHeadline) await form.getByLabel(/Concept \d+ headline/).first().fill(firstHeadline);
  await form.getByRole("button", { name: /Approve & generate/ }).click();
}

export const canvas = (page: Page) => page.getByRole("region", { name: "Creative canvas" });
export const cards = (page: Page) => canvas(page).getByRole("article");
export const readyImages = (page: Page) => canvas(page).locator('article img[alt^="Ad #"]');

export async function waitForReady(page: Page, n: number) {
  await expect(readyImages(page)).toHaveCount(n, { timeout: 60_000 });
  await expect(canvas(page).getByTestId("skeleton")).toHaveCount(0, { timeout: 60_000 });
}
