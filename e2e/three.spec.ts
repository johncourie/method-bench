import { expect, test, type Page } from "@playwright/test";

const at = (page: Page, id: string): Promise<{ x: number; y: number }> =>
  page.evaluate((k) => (window as unknown as { methodBenchDrawing: { locate(id: string): { x: number; y: number } } }).methodBenchDrawing.locate(k), id);
const method = (page: Page): Promise<any> => page.evaluate(() => (window as unknown as { methodBench: any }).methodBench.method);

test("the instrument drawing can be operated, and stays in step with the form", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" }); // camera moves at once, so positions are stable
  await page.goto("/");
  await page.getByRole("button", { name: /Hemp cannabinoids/ }).click();
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  const drawing = page.locator(".bench3d canvas");
  await expect(drawing).toBeVisible();
  await expect(drawing).toHaveAttribute("aria-label", /generic liquid chromatograph/);

  // Pump: drag the flow knob 60 px to the right = 10 detents of 0.02 mL/min.
  await page.getByRole("button", { name: "Pump", exact: true }).click();
  let p = await at(page, "flow");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 30, p.y, { steps: 5 });
  await page.mouse.move(p.x + 61, p.y, { steps: 5 });
  await page.mouse.up();
  expect((await method(page)).flowMlMin).toBeCloseTo(0.5, 6);
  await expect(page.getByLabel("Flow, mL/min")).toHaveValue("0.5");
  // Turning the end of the gradient away from the start makes a gradient, shown in the form's table.
  p = await at(page, "bEnd");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 121, p.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("#prog-b-1")).toHaveValue("90");
  // A change made in the form shows on the drawing's own state the next time it is read.
  await page.getByLabel("Flow, mL/min").fill("0.3");
  await page.getByLabel("Flow, mL/min").press("Tab");
  expect((await method(page)).flowMlMin).toBe(0.3);
  await page.screenshot({ path: "e2e/shots/three-pump.png" }).catch(() => undefined); // a picture for review, never a reason to fail

  // Solvents: selecting reservoir controls, changing the buffer and the pH of solvent A.
  await page.getByRole("button", { name: "Solvents", exact: true }).click();
  p = await at(page, "buffer-next");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByLabel("Solvent A buffer")).toHaveValue("acetate");
  // Acetate does not buffer at pH 3: the form says so, and the panel shows it.
  await expect(page.getByText(/outside the range where acetic acid with ammonium acetate buffers/)).toBeVisible();
  p = await at(page, "ph");
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -100);
  await expect(page.getByLabel("Solvent A pH")).toHaveValue("4");
  await expect(page.getByText(/outside the range where/)).toHaveCount(0);
  await page.screenshot({ path: "e2e/shots/three-solvents.png" }).catch(() => undefined); // a picture for review, never a reason to fail
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 100);
  p = await at(page, "buffer-next");
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByLabel("Solvent A buffer")).toHaveValue("formate");
  await expect(page.getByLabel("Solvent A pH")).toHaveValue("3");

  // Oven: scroll the temperature knob up three detents, then change column.
  await page.getByRole("button", { name: "Column oven", exact: true }).click();
  p = await at(page, "temp");
  await page.mouse.move(p.x, p.y);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await expect(page.getByLabel("Column temperature, °C")).toHaveValue("33");
  p = await at(page, "col-next");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByLabel("Column", { exact: true })).toHaveValue("cb-c18sp");

  // Detector: one press switches to the mass detector, one more back.
  await page.getByRole("button", { name: "Detector", exact: true }).click();
  p = await at(page, "det-mode");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("ms");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByLabel("Type", { exact: true })).toHaveValue("uv");

  // Autosampler: choose the blank vial and press Inject on the module.
  await page.getByRole("button", { name: "Autosampler", exact: true }).click();
  p = await at(page, "vial-blank");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByLabel("What to inject")).toHaveValue("blank");
  p = await at(page, "inject");
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole("heading", { name: "Chromatogram, run 1" })).toBeVisible();
  await expect(page.locator("table", { hasText: "Run" }).last()).toContainText("Blank (diluent)");
  await page.screenshot({ path: "e2e/shots/three-sampler.png" }).catch(() => undefined); // a picture for review, never a reason to fail
  await page.getByRole("button", { name: "Whole instrument" }).click();
  await page.screenshot({ path: "e2e/shots/three-bench.png" }).catch(() => undefined); // a picture for review, never a reason to fail

  // The form route still reaches every setting, and the drawing can be put away.
  await page.getByRole("button", { name: "Pump settings in the form" }).click();
  await expect(page.getByLabel("Flow, mL/min")).toBeFocused();
  await page.getByRole("button", { name: "Hide the drawing" }).click();
  await expect(page.locator(".bench3d canvas")).toHaveCount(0);
  await expect(page.getByLabel("Flow, mL/min")).toBeVisible();
  expect(errors).toEqual([]);
});

test("run comparison draws, and its table carries the same information", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Hemp cannabinoids/ }).click();
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  for (const pct of ["60", "70", "80"]) {
    await page.locator("#prog-b-0").fill(pct);
    await page.locator("#prog-b-0").press("Tab");
    await page.getByRole("button", { name: "Inject", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Chromatogram, run 3" })).toBeVisible();
  await page.getByRole("tab", { name: "Compare runs" }).click();
  await page.getByLabel("Colour stands for", { exact: true }).selectOption("phi0");
  await expect(page.locator(".waterfall canvas")).toBeVisible();
  await expect(page.locator("table", { hasText: "Traces shown" }).locator("tbody tr")).toHaveCount(3);
  await expect(page.locator("table", { hasText: "Traces shown" })).toContainText("60 % B");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "e2e/shots/three-compare.png", fullPage: true }).catch(() => undefined); // a picture for review, never a reason to fail
  expect(errors).toEqual([]);
});

test("moving parts: the needle samples, the run replays with flow, and the oven door opens when looked at", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const motion = (): Promise<{ doorOpen: boolean; needleBusy: boolean; replaying: boolean }> => page.evaluate(() => (window as unknown as { methodBenchDrawing: { motion: any } }).methodBenchDrawing.motion);
  await page.goto("/");
  await page.getByRole("button", { name: /^(Start|Discard)/ }).click();
  await expect(page.locator(".bench3d canvas")).toBeVisible();
  // The first injection of a page visit is not replayed (it could be an old notebook reloading), the second is.
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chromatogram, run 1" })).toBeVisible();
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chromatogram, run 2" })).toBeVisible();
  await expect.poll(async () => (await motion()).needleBusy, { timeout: 3000 }).toBe(true);
  await expect.poll(async () => (await motion()).replaying, { timeout: 3000 }).toBe(true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "e2e/shots/three-running.png" }).catch(() => undefined); // a picture for review, never a reason to fail
  await expect.poll(async () => { const m = await motion(); return m.replaying || m.needleBusy; }, { timeout: 8000 }).toBe(false);
  await page.getByRole("button", { name: "Column oven", exact: true }).click();
  await expect.poll(async () => (await motion()).doorOpen, { timeout: 3000 }).toBe(true);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "e2e/shots/three-oven.png" }).catch(() => undefined); // a picture for review, never a reason to fail
  await page.getByRole("button", { name: "Whole instrument" }).click();
  await expect.poll(async () => (await motion()).doorOpen, { timeout: 3000 }).toBe(false);
  // With reduced motion nothing animates, and injecting still works.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Inject", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chromatogram, run 3" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await motion()).toEqual({ doorOpen: false, needleBusy: false, replaying: false });
  expect(errors).toEqual([]);
});
