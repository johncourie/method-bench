// Browser regressions for defects found in the usability review of 2026-11-13.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("an edit followed straight away by a click on Inject is not lost", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  await page.getByLabel("Flow, mL/min").fill("0.8");
  // No Tab, no blur: click the button while the field still has focus.
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chromatogram, run 1" })).toBeVisible();
  const flow = await page.evaluate(() => (window as unknown as { methodBench: any }).methodBench.lab.session.runs[0].method.flowMlMin);
  expect(flow).toBe(0.8);
});

test("keyboard focus survives edits and button presses", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  await page.getByLabel("Flow, mL/min").fill("0.9");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(50);
  // Focus moved on to the next control, not to the top of the page.
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("INPUT");
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).id)).toContain("injection");
  await page.getByRole("button", { name: "Add step" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Add step");
  await expect(page.locator("#prog-t-2")).toBeVisible();
});

test("an emptied or out-of-range number field does not become zero or freeze the page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  const temp = page.getByLabel("Column temperature, °C");
  await temp.fill("");
  await temp.press("Tab");
  await expect(temp).toHaveValue("30");
  const run = page.getByLabel("Run time, min");
  await run.fill("100000");
  await run.press("Tab");
  await expect(run).toHaveValue("240");
  const state = await page.evaluate(() => (window as unknown as { methodBench: any }).methodBench.method);
  expect(state.tempC).toBe(30);
  expect(state.runTimeMin).toBe(240);
});

test("a damaged notebook file is refused and the app keeps working, also after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await page.getByRole("tab", { name: "Setup" }).click();
  const good = await page.evaluate(() => (window as unknown as { methodBench: any }).methodBench.exportSession());
  const bad = JSON.parse(good);
  bad.runs[0].method.columnId = "no-such-column";
  await page.getByLabel("Load a notebook").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(page.locator("#live")).toHaveText(/column this version does not have/);
  await page.reload();
  await page.getByRole("tab", { name: "Instrument" }).click();
  await expect(page.getByRole("heading", { name: "Chromatogram, run 1" })).toBeVisible();
  // A good file still loads, and brings its processing choices with it.
  const edited = JSON.parse(good);
  edited.analysis.weighting = "1/x";
  edited.analysis.response = "height";
  await page.getByRole("tab", { name: "Setup" }).click();
  await page.getByLabel("Load a notebook").setInputFiles({ name: "good.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(edited)) });
  await page.getByRole("tab", { name: "Quantitation" }).click();
  await expect(page.getByLabel("Weighting", { exact: true })).toHaveValue("1/x");
  await expect(page.getByLabel("Response", { exact: true })).toHaveValue("height");
});

test("text typed as a name cannot inject markup", async ({ page }) => {
  await page.goto("/");
  const name = page.getByLabel("Your name (for the report)");
  await name.fill('<img src=x onerror="window.__pwned=1">');
  await name.press("Tab");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.getByText('<img src=x onerror="window.__pwned=1">')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("switching tabs at phone width starts at the top of the new tab", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 2500));
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.getByRole("heading", { name: "Report", exact: true })).toBeInViewport();
});

test("the resolution map passes the accessibility scan in the dark theme and the report prints its heading", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  for (const tg of ["20", "60"]) {
    await page.locator("#prog-t-1").fill(tg);
    await page.locator("#prog-t-1").press("Tab");
    await page.getByLabel("Run time, min").fill(String(Number(tg) + 10));
    await page.getByRole("button", { name: "Inject", exact: true }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`run ${tg === "20" ? 1 : 2}`) })).toBeVisible();
    await page.evaluate(() => {
      const app = (window as unknown as { methodBench: any }).methodBench;
      const ex = app.lab.run(app.selectedRun);
      for (const p of ex.integration.peaks) {
        const near = ex.result.peaks.filter((t: any) => t.eluted && t.area > 0).sort((a: any, b: any) => Math.abs(a.tR - p.tR) - Math.abs(b.tR - p.tR))[0];
        if (near && Math.abs(near.tR - p.tR) < 0.15) app.lab.label(ex.record.id, p.tR, near.soluteId);
      }
      app.fitRuns.add(ex.record.id);
      app.render();
    });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.getByRole("tab", { name: "Fit and predict" }).click();
  await expect(page.getByRole("group", { name: "Critical resolution map" }).getByRole("button")).toHaveCount(70);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id} ${v.nodes[0]?.target}`)).toEqual([]);
  await page.getByRole("tab", { name: "Report" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("heading", { name: "Report", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
});
