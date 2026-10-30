import { expect, test } from "@playwright/test";
import { canvas, flags, onboard, remote, resetFlags, waitForReady } from "./helpers";

test.beforeEach(async ({ request }) => resetFlags(request));

async function start(page: import("@playwright/test").Page, url: string) {
  await page.goto("/");
  await page.getByLabel("Store URL").fill(url);
  await page.getByRole("button", { name: "Make ads" }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}$/);
}

test("not a Shopify store and Firecrawl fails: the agent asks for product URLs or a photo upload", async ({ page }) => {
  await start(page, "blank.example");
  await expect(page.locator('[data-tool="researchStore"]')).toContainText("needs attention");
  await expect(page.getByText(/product page URLs, or upload product photos/)).toBeVisible();
  await expect(page.getByLabel("Message")).toBeEnabled();
});

test("brand extraction fails: the kit is pre-filled from meta tags and marked 'please check'", async ({ page, request }) => {
  test.skip(remote, "needs runtime test hooks");
  await flags(request, { MOCK_FIRECRAWL_FAIL: "1" });
  await start(page, "fernwood.example");
  await expect(page.getByText(/Brand extraction fell back to page meta tags/)).toBeVisible();
  const form = page.getByRole("form", { name: "Brand kit" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Brand name")).toHaveValue("Fernwood Candle Co.");
  await expect(form.getByLabel("Color 1 hex")).toHaveValue("#2F4A3A");
  await expect(form.getByRole("group", { name: /Colors/ }).getByText("please check")).toBeVisible();
});

test("headline too long: the agent proposes 3 shorter options", async ({ page }) => {
  await onboard(page);
  await waitForReady(page, 6);
  await page.getByLabel("Message").fill('Change ad 2 headline to "The most comfortable finger loop phone case ever made"');
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Here are 3 shorter options/)).toBeVisible();
});

test("stream drops: the chat shows a recoverable message, not a dead end", async ({ page }) => {
  await onboard(page);
  await waitForReady(page, 6);
  await page.route("**/api/chat", (route) => route.abort("connectionreset"));
  await page.getByLabel("Message").fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "connection dropped" })).toBeVisible();
  await page.unroute("**/api/chat");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Paste a store URL|mock mode/).last()).toBeVisible();
  await expect(canvas(page).getByRole("article")).toHaveCount(6);
});
