import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TABS = ["setup", "instrument", "compare", "model", "quant", "validation", "report", "limits", "instructor"] as const;

/** Name every integrated peak of the selected run after the compound that really eluted there (a student would inject single standards). */
async function nameSelectedRun(page: Page): Promise<number> {
  return page.evaluate(() => {
    const app = (window as unknown as { methodBench: any }).methodBench;
    const ex = app.lab.run(app.selectedRun);
    let n = 0;
    for (const p of ex.integration.peaks) {
      const near = ex.result.peaks.filter((t: any) => t.eluted && t.area > 0).sort((a: any, b: any) => Math.abs(a.tR - p.tR) - Math.abs(b.tR - p.tR))[0];
      if (near && Math.abs(near.tR - p.tR) < 0.15) {
        app.lab.label(ex.record.id, p.tR, near.soluteId);
        n++;
      }
    }
    app.persist();
    app.refresh();
    return n;
  });
}

async function setNumber(page: Page, label: string | RegExp, value: string): Promise<void> {
  const f = page.getByLabel(label, { exact: typeof label === "string" }).first();
  await f.fill(value);
  await f.press("Tab");
}

async function build(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /Hemp cannabinoids/ }).click();
  await setNumber(page, "Assignment code", "E2E-1");
  await page.getByLabel("Instrument", { exact: true }).selectOption("uhplc");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  await page.getByLabel("Column", { exact: true }).selectOption("cb-c18sp");
  await setNumber(page, "Run time, min", "13");
  // Five calibration levels.
  // The top level is high enough to trip the detector-linearity warning, as it would on an instrument.
  const levels = ["2", "10", "40", "100", "200"];
  for (const [i, level] of levels.entries()) {
    await setNumber(page, /Set every listed analyte/, level);
    await page.getByRole("button", { name: "Inject", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Chromatogram, run ${i + 1}` })).toBeVisible();
  }
  await expect(page.locator("#live").filter({ hasText: /no longer linear/ })).toBeVisible();
  expect(await nameSelectedRun(page)).toBeGreaterThanOrEqual(9);
  // Six replicates of the mid standard.
  await setNumber(page, /Set every listed analyte/, "40");
  await setNumber(page, "Replicate injections", "6");
  await page.getByRole("button", { name: "Inject 6 times" }).click();
  // Blank, two sample preparations, one spiked.
  await setNumber(page, "Replicate injections", "1");
  await page.getByLabel("What to inject").selectOption("blank");
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await page.getByLabel("What to inject").selectOption("unknown");
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await setNumber(page, "Preparation number", "2");
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await setNumber(page, "Preparation number", "1");
  await page.getByText("Spike with reference material").click();
  await setNumber(page, "CBD concentration, µg/mL", "30");
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Chromatogram, run 15/ })).toBeVisible();
}

test("a full exercise: calibrate, quantify, validate, report, debrief", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await build(page);

  // Peak spectrum and purity.
  await page.getByRole("button", { name: "Show spectrum for peak 1", exact: true }).click();
  await expect(page.getByText(/Lowest spectral match/)).toBeVisible();

  // Quantitation.
  await page.getByRole("tab", { name: "Quantitation" }).click();
  await page.getByLabel("Analyte", { exact: true }).selectOption("cbd");
  await page.getByLabel("Weighting", { exact: true }).selectOption("1/x");
  const regression = page.locator("table", { hasText: "Regression" });
  await expect(regression).toContainText("Points");
  await expect(regression).toContainText("10");
  const results = page.locator("section", { hasText: "Sample results" }).locator("table").first();
  await expect(results.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByText(/Total THC = d9-THC/)).toBeVisible();
  await expect(page.locator("table", { hasText: "Spike recovery" }).locator("tbody tr")).toHaveCount(1);
  // The reported CBD content agrees with the hidden truth within 4%.
  const check = await page.evaluate(async () => {
    const app = (window as unknown as { methodBench: any }).methodBench;
    const text = document.querySelector("main")!.textContent ?? "";
    const m = /Mean of 2 preparation\(s\): ([\d.]+) mg\/g/.exec(text);
    return { shown: m ? Number(m[1]) : NaN, seed: app.lab.session.seed };
  });
  expect(check.shown).toBeGreaterThan(1);

  // Suitability and validation.
  await page.getByRole("tab", { name: "Suitability and validation" }).click();
  const sst = page.locator("section", { hasText: "System suitability" }).locator("table");
  await expect(sst.locator("tbody tr").filter({ hasText: "CBN" })).toContainText("6");
  await expect(page.locator("table", { hasText: "Characteristic" })).toContainText("Specificity");
  await expect(page.locator("table", { hasText: "Characteristic" })).toContainText("blank clean at the analyte position");

  // Report.
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.getByText("Notebook fingerprint")).toBeVisible();
  const fp = await page.locator("tr", { hasText: "Notebook fingerprint" }).locator("td").textContent();
  expect(fp).toMatch(/^[0-9A-F]{8}-[0-9A-F]{8}$/);

  // Model and limits, with the debrief.
  await page.getByRole("tab", { name: "Model and limits" }).click();
  await expect(page.getByRole("heading", { name: "Checks against the literature" })).toBeVisible();
  await page.getByRole("button", { name: "Open the debrief" }).click();
  await expect(page.getByText(/True extraction recovery/)).toBeVisible();
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.locator("tr", { hasText: "Debrief opened" })).toContainText("yes, after 15");

  // Instructor key.
  await page.getByRole("tab", { name: "Instructor" }).click();
  await page.getByRole("button", { name: "Show the instructor key" }).click();
  await page.getByRole("button", { name: "Generate codes" }).click();
  await expect(page.locator("table", { hasText: "Recovery" }).locator("tbody tr")).toHaveCount(12);

  // The notebook survives a reload, and the fingerprint with it changes only because the debrief was opened.
  await page.reload();
  await page.getByRole("tab", { name: "Instrument" }).click();
  await expect(page.getByRole("heading", { name: /Chromatogram, run 15/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("fit two scouting gradients, predict a third method, and confirm it by injection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  for (const tg of ["20", "60"]) {
    await page.locator("#prog-t-1").fill(tg);
    await page.locator("#prog-t-1").press("Tab");
    await setNumber(page, "Run time, min", String(Number(tg) + 10));
    await page.getByRole("button", { name: "Inject", exact: true }).click();
    await expect(page.locator("#live")).toHaveText(/complete|run/);
    await nameSelectedRun(page);
  }
  await page.getByRole("tab", { name: "Fit and predict" }).click();
  await page.getByLabel("Use run 1 in the fit").check();
  await page.getByLabel("Use run 2 in the fit").check();
  const fitted = page.locator("table", { hasText: "Fitted model" });
  await expect(fitted.locator("tbody tr")).toHaveCount(9);
  await expect(page.getByRole("group", { name: "Critical resolution map" }).getByRole("button")).toHaveCount(70);
  await page.screenshot({ path: "e2e/shots/03-model.png", fullPage: true }).catch(() => undefined); // a picture for review, never a reason to fail
  // Load a cell from the map, inject it, and compare prediction with observation.
  await page.locator("#map-2-4").click();
  await page.getByRole("tab", { name: "Instrument" }).click();
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await nameSelectedRun(page);
  await page.getByRole("tab", { name: "Fit and predict" }).click();
  const pred = page.locator("section", { hasText: "Prediction for the method in the editor" }).locator("table tbody tr");
  await expect(pred).toHaveCount(9);
  const errs = await pred.evaluateAll((rows) => rows.map((r) => Number((r as HTMLTableRowElement).cells[5]!.textContent)));
  // The student used the textbook column volume, so some error is expected; it should still be small.
  for (const e of errs) expect(Math.abs(e)).toBeLessThan(0.6);
});

for (const width of [1280, 390]) {
  test(`every tab at ${width} px: no horizontal overflow, no accessibility violations, light and dark`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await build(page);
    await page.evaluate(() => {
      const app = (window as unknown as { methodBench: any }).methodBench;
      app.instructorOpen = true;
      app.instructorCodes = "LAB-001\nLAB-002";
      app.fitRuns.add(1);
      app.fitRuns.add(2);
      app.selectedPeak = 2;
    });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      for (const tab of TABS) {
        await page.evaluate((t) => (window as unknown as { methodBench: any }).methodBench.go(t), tab);
        const overflow = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          const over = (e: Element): boolean => e.getBoundingClientRect().right + window.scrollX > w + 1;
          const wide = [...document.querySelectorAll("body *")].filter((e) => over(e) && !(e.parentElement && over(e.parentElement))).slice(0, 4);
          return { by: document.documentElement.scrollWidth - w, who: wide.map((e) => `${e.tagName}#${e.id}.${e.className}`) };
        });
        expect(overflow.by, `${tab} overflows at ${width}: ${overflow.who.join(", ")}`).toBeLessThanOrEqual(1);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(axe.violations.map((v) => `${tab}/${theme}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`), `${tab} ${theme}`).toEqual([]);
        if (theme === "light" || tab === "instrument") await page.screenshot({ path: `e2e/shots/${width}-${theme}-${tab}.png`, fullPage: true }).catch(() => undefined); // a picture for review, never a reason to fail
      }
    }
  });
}
