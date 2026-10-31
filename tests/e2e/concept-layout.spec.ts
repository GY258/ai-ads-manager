import { test, expect } from "@playwright/test";
// Regression: a long product name (no-wrap line) used to widen the fieldset past the chat panel.
const long = "Lightweight comfort from natural materials for every single day of the year";
for (const vp of [{ w: 1400, h: 900 }, { w: 390, h: 844 }]) {
  test(`concept card fits ${vp.w}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/");
    await page.getByLabel("Store URL").fill("www.loopycases.com");
    await page.getByRole("button", { name: "Make ads" }).click();
    await page.waitForURL(/\/c\//);
    const kit = page.getByRole("form", { name: "Brand kit" });
    await expect(kit).toBeVisible({ timeout: 30_000 });
    await kit.getByRole("button", { name: "Confirm brand kit" }).click();
    const form = page.getByRole("form", { name: "Review concepts" }).last();
    await expect(form).toBeVisible({ timeout: 30_000 });
    await form.getByLabel(/Concept \d+ subhead/).first().fill(long);
    await form.locator(".truncate").first().evaluate((e) => (e.textContent = "Men's Canvas Runner NZ - Deep Navy Stripes (Blizzard Sole) Limited Edition"));
    await form.locator("details").first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
    const c = form.getByTestId("concept").first();
    await c.scrollIntoViewIfNeeded();
    const over = await form.evaluate((f) => [f, ...f.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > Math.min(f.closest("section")!.getBoundingClientRect().right, innerWidth) + 1).map((e) => e.tagName + "." + e.className).slice(0, 5));
    expect(over).toEqual([]);
  });
}
