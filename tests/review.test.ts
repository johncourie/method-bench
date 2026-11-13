// Regression tests for defects found in the two adversarial reviews of 2026-11-13.
import { describe, expect, it } from "vitest";
import { catalog } from "../src/data/index.ts";
import { fitLine, limitsFromCalibration } from "../src/engine/calibration.ts";
import { fitLss, predictLss } from "../src/engine/fit.ts";
import { integrate } from "../src/engine/integrate.ts";
import { gaussian } from "../src/engine/peakshape.ts";
import { makeRng } from "../src/engine/rng.ts";
import { degrade } from "../src/lab/degradation.ts";
import { contentAsReceived, truthFor } from "../src/lab/samples.ts";
import { Lab, loadSession, newSession, saveSession } from "../src/lab/session.ts";

const cannabis = catalog.cases.get("cannabis")!;
const greentea = catalog.cases.get("greentea")!;

function trace(rateHz: number, minutes: number, peaks: Array<{ t: number; sigma: number; area: number }>, noise: number, seed = 1): { time: Float64Array; signal: Float64Array } {
  const n = Math.floor(minutes * 60 * rateHz) + 1;
  const time = new Float64Array(n);
  const signal = new Float64Array(n);
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) {
    time[i] = i / (60 * rateHz);
    signal[i] = noise * rng.gauss();
    for (const p of peaks) signal[i]! += p.area * gaussian(time[i]!, p.t, p.sigma);
  }
  return { time, signal };
}

describe("peak measurement on the recorded signal", () => {
  it("a 1.2 s wide peak at 10 Hz keeps its height, width and plate number", () => {
    const sigma = 0.0195 / 2.355; // w_half 1.17 s
    const { time, signal } = trace(10, 3, [{ t: 1.5, sigma, area: 2 }], 0.02);
    const p = integrate(time, signal).peaks[0]!;
    expect(p.wHalf / (2.355 * sigma)).toBeGreaterThan(0.95);
    expect(p.wHalf / (2.355 * sigma)).toBeLessThan(1.06);
    expect(p.height / (2 / (sigma * Math.sqrt(2 * Math.PI)))).toBeGreaterThan(0.93);
    expect(p.plates / (1.5 / sigma) ** 2).toBeGreaterThan(0.88);
  });
  it("a peak cut off by the end of the run is flagged and does not get a negative area", () => {
    const { time, signal } = trace(10, 5, [{ t: 4.98, sigma: 0.05, area: 8 }], 0.02);
    const p = integrate(time, signal).peaks[0]!;
    expect(p.truncated).toBe(true);
    expect(p.area).toBeGreaterThan(0);
  });
  it("area is nearly unbiased at a signal-to-noise ratio near 20", () => {
    const sigma = 0.03;
    const ratios: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const height = 20 * 3 * 0.05; // S/N = 2H / (6 sd) = 20
      const area = height * sigma * Math.sqrt(2 * Math.PI);
      const { time, signal } = trace(10, 6, [{ t: 3, sigma, area }], 0.05, seed);
      const p = integrate(time, signal).peaks.find((q) => Math.abs(q.tR - 3) < 0.1);
      if (p) ratios.push(p.area / area);
    }
    expect(ratios.length).toBeGreaterThan(36);
    const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
    expect(Math.abs(mean - 1)).toBeLessThan(0.04);
  });
});

describe("limits under weighting", () => {
  it("detection and quantitation limits do not collapse when a weighted fit is chosen", () => {
    const rng = makeRng(3);
    const pts = [1, 2, 5, 10, 50, 100, 200].flatMap((x) => [0, 1].map(() => ({ x, y: 0.5 * x + 0.05 * rng.gauss() + 0.004 * x * rng.gauss() })));
    const ql = (w: "none" | "1/x" | "1/x2") => limitsFromCalibration(fitLine(pts, w)!, 1).ql;
    // All three estimate the noise near the bottom of the range, so they must be of the same order.
    expect(ql("1/x") / ql("1/x2")).toBeGreaterThan(0.3);
    expect(ql("1/x") / ql("1/x2")).toBeLessThan(3.5);
    expect(ql("1/x2")).toBeGreaterThan(0.3);
  });
});

describe("degradation", () => {
  it("light at room temperature oxidizes THC to CBN and leaves the acids alone", () => {
    const out = degrade(new Map([["thca", 1], ["cbda", 1], ["d9thc", 1]]), cannabis.reactions, "light", 500, 25);
    expect(out.get("thca")).toBeCloseTo(1, 9);
    expect(out.get("cbda")).toBeCloseTo(1, 9);
    expect(out.get("d9thc")!).toBeLessThan(0.7);
    expect(out.get("d9thc")! + out.get("cbn")!).toBeCloseTo(1, 6);
  });
  it("the aged hemp lot matches its description, and the key shows content as received", () => {
    const seed = Array.from({ length: 400 }, (_, i) => `AGE-${i}`).find((s) => truthFor(cannabis, s).variant.id === "aged")!;
    const made = truthFor(cannabis, seed).mgPerG;
    const got = contentAsReceived(cannabis, seed, catalog.solutes);
    expect(got.d9thc!).toBeLessThan(0.75 * made.d9thc!);
    expect(got.cbn!).toBeGreaterThan(made.cbn!);
    expect(got.thca!).toBeCloseTo(made.thca!, 9);
    expect(got.cbda!).toBeCloseTo(made.cbda!, 9);
  });
  it("base and peroxide stress give a degradant that elutes, so lost material is visible", () => {
    const out = degrade(new Map([["egcg", 1]]), greentea.reactions, "base", 1, 25);
    expect(out.get("egcg")!).toBeLessThan(0.5);
    expect(out.get("egcg")! + out.get("gtox")!).toBeCloseTo(1, 6);
    for (const col of greentea.columns) expect(catalog.solutes.get("gtox")!.retention[col]?.MeCN).toBeDefined();
  });
});

describe("student fit guards", () => {
  const t0 = 1.6;
  const tD = 1;
  const prog = (tG: number) => [{ t: 0, phi: 0.05 }, { t: tG, phi: 0.95 }];
  const obs = (tG: number, scale = 1) => ({ program: prog(tG), t0: t0 * scale, tD, tR: predictLss(6.5, 13, prog(tG), t0, tD) });
  it("replicate runs with scatter give no model", () => {
    const a = obs(20);
    expect(fitLss([a, { ...a, tR: a.tR + 0.01 }])).toBeNull();
  });
  it("a column volume three times too large gives no model", () => {
    expect(fitLss([obs(15, 3), obs(45, 3)])).toBeNull();
  });
  it("a peak that elutes before the gradient reaches it in both runs gives no model", () => {
    const early = (tG: number) => ({ program: prog(tG), t0, tD: 3, tR: predictLss(0.2, 6, prog(tG), t0, 3) });
    expect(fitLss([early(15), early(45)])).toBeNull();
  });
});

describe("notebook", () => {
  const lab = new Lab(catalog, newSession(greentea, "NB-1", "uhplc"));
  const method = { ...structuredClone(greentea.defaultMethod), columnId: "gt-c18-spp4" };
  const run = lab.inject(method, { kind: "standard", levels: Object.fromEntries(greentea.analytes.map((id) => [id, 50])), prep: 1 }, 0.05);

  it("two neighbouring resolved peaks can be given different names", () => {
    const peaks = lab.execute(run).integration.peaks;
    const [a, b] = [peaks[peaks.length - 2]!, peaks[peaks.length - 1]!];
    expect((b.tR - a.tR) / a.tR).toBeLessThan(0.025); // closer than the identification window
    lab.label(run.id, a.tR, "ecg");
    lab.label(run.id, b.tR, "cg");
    const names = lab.execute(run).names;
    expect(names.get(a.n)).toBe("ecg");
    expect(names.get(b.n)).toBe("cg");
    lab.label(run.id, a.tR, "");
    expect(lab.execute(run).names.get(a.n)).toBeUndefined();
    expect(lab.execute(run).names.get(b.n)).toBe("cg");
  });

  it("processing choices travel with the notebook file", () => {
    Object.assign(lab.session.analysis, { weighting: "1/x", response: "height", solute: "caf", refRun: run.id, excluded: [`caf|${run.id}`] });
    lab.session.analysis.integration.minSignalToNoise = 12;
    const back = loadSession(saveSession(lab.session), catalog);
    expect(back.analysis).toEqual(lab.session.analysis);
  });

  it("damaged or out-of-date notebooks are refused with a message, never loaded", () => {
    const good = JSON.parse(saveSession(lab.session)) as Record<string, unknown> & { runs: Array<Record<string, unknown>> };
    const bad: unknown[] = [
      { ...good, runs: [{}] },
      { ...good, runs: [null] },
      { ...good, runs: [{ ...good.runs[0], method: { ...(good.runs[0]!.method as object), columnId: "no-such-column" } }] },
      { ...good, runs: [{ ...good.runs[0], method: { ...(good.runs[0]!.method as object), program: "x" } }] },
      { ...good, runs: [{ ...good.runs[0], method: { ...(good.runs[0]!.method as object), runTimeMin: 1e9 } }] },
      { ...good, runs: [{ ...good.runs[0], spec: { kind: "standard", levels: { nope: 1 }, prep: 1 } }] },
      { ...good, instrumentId: "x" },
      [],
      "text",
    ];
    for (const b of bad) expect(() => loadSession(JSON.stringify(b), catalog)).toThrow(/notebook|Injection|This file/);
    expect(() => loadSession("{not json", catalog)).toThrow(/not a Method Bench notebook/);
  });

  it("refuses a run that would record more than a million points", () => {
    expect(() => lab.inject({ ...method, runTimeMin: 240, detector: { kind: "uv", nm: 280, rateHz: 100 } }, { kind: "blank" }, 0.05)).toThrow(/million|Run time|Data rate/);
  });
});
