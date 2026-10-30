import { expect, test } from "@playwright/test";

test("home renders and health is ok", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Turn any store into ads/ })).toBeVisible();
  await expect(page.getByLabel("Store URL")).toBeVisible();
  const health = await request.get("/api/health");
  expect((await health.json()).status).toBe("ok");
});
