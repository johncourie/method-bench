import { expect, test } from "@playwright/test";

test("first run: start, inject a standard, see peaks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Setup" })).toBeVisible();
  await page.screenshot({ path: "e2e/shots/01-setup.png", fullPage: true }).catch(() => undefined); // a picture for review, never a reason to fail
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { name: "Method" })).toBeVisible();
  await page.getByRole("button", { name: "Inject" }).click();
  await expect(page.getByRole("heading", { name: /Chromatogram, run 1/ })).toBeVisible();
  const rows = page.locator("table", { hasText: "Integrated peaks" }).locator("tbody tr");
  await expect(rows).toHaveCount(9);
  await page.screenshot({ path: "e2e/shots/02-instrument.png", fullPage: true }).catch(() => undefined); // a picture for review, never a reason to fail
  expect(errors).toEqual([]);
});
