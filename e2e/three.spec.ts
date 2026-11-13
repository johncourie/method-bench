import { expect, test } from "@playwright/test";

test("instrument drawing and run comparison draw without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/");
  await page.getByRole("button", { name: /Hemp cannabinoids/ }).click();
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  const drawing = page.locator(".bench3d canvas");
  await expect(drawing).toBeVisible();
  await expect(drawing).toHaveAttribute("aria-label", /generic liquid chromatograph/);
  // The module shortcuts reach the same settings as picking a module in the drawing.
  await page.getByRole("button", { name: "Pump", exact: true }).click();
  await expect(page.getByLabel("Flow, mL/min")).toBeFocused();
  for (const pct of ["60", "70", "80"]) {
    await page.locator("#prog-b-0").fill(pct);
    await page.locator("#prog-b-0").press("Tab");
    await page.getByRole("button", { name: "Inject", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Chromatogram, run 3" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e/shots/three-bench.png" });
  await page.getByRole("tab", { name: "Compare runs" }).click();
  await page.getByLabel("Colour stands for", { exact: true }).selectOption("phi0");
  await expect(page.locator(".waterfall canvas")).toBeVisible();
  await expect(page.locator("table", { hasText: "Traces shown" }).locator("tbody tr")).toHaveCount(3);
  await expect(page.locator("table", { hasText: "Traces shown" })).toContainText("60 % B");
  await page.waitForTimeout(600);
  await page.screenshot({ path: "e2e/shots/three-compare.png", fullPage: true });
  // Hiding the drawing leaves the form fully usable.
  await page.getByRole("tab", { name: "Instrument" }).click();
  await page.getByRole("button", { name: "Hide the drawing" }).click();
  await expect(page.locator(".bench3d canvas")).toHaveCount(0);
  await expect(page.getByLabel("Flow, mL/min")).toBeVisible();
  expect(errors).toEqual([]);
});
