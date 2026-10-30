import { expect, test } from "@playwright/test";

test("home renders and health is ok", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI Ads Manager" })).toBeVisible();
  await expect(page.getByLabel("Store URL")).toBeVisible();
  const health = await request.get("/api/health");
  expect((await health.json()).status).toBe("ok");
});

test("chat route streams a mock reply in the browser", async ({ page }) => {
  await page.goto("/c/00000000-0000-4000-8000-0000000000aa");
  await page.getByLabel("Message").fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("running in mock mode")).toBeVisible();
});
