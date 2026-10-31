import { expect, test } from "@playwright/test";

test("home → research progress → brand kit form → edit a color, pick 2 products, confirm", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Store URL").fill("www.loopycases.com");
  await page.getByRole("button", { name: "Make ads" }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}$/);

  await expect(page.locator('[data-tool="researchStore"]')).toBeVisible();
  // First visit scrapes; later tests in the same server reuse the confirmed brand (no re-scrape).
  await expect(page.getByRole("list", { name: "Progress" }).getByText(/Found 40 products|Using the confirmed brand kit/).first()).toBeVisible();
  const form = page.getByRole("form", { name: "Brand kit" });
  await expect(form).toBeVisible();

  await form.getByLabel("Color 1 hex").fill("#FF4FA3");
  const picked = form.getByRole("button", { pressed: true });
  await expect(picked).toHaveCount(3);
  await picked.first().click();
  await expect(form.getByRole("button", { pressed: true })).toHaveCount(2);
  await form.getByRole("button", { name: "Confirm brand kit" }).click();

  await expect(page.getByText(/^Confirmed ·/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Loopy Cases/ })).toContainText("confirmed");
});

test("invalid URL shows an inline error with an example", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Store URL").fill("not a url");
  await page.getByRole("button", { name: "Make ads" }).click();
  await expect(page.locator("#store-url-error")).toContainText("www.loopycases.com");
  await page.getByLabel("Store URL").fill("https://nowhere.invalid");
  await page.getByRole("button", { name: "Make ads" }).click();
  await expect(page.locator("#store-url-error")).toContainText("couldn't find nowhere.invalid");
});
