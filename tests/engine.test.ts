import { describe, expect, it } from "vitest";
import { fitLine, interpolate, limitsFromCalibration, rsdPct } from "../src/engine/calibration.ts";
import { deadTimeMin, pressureBar } from "../src/engine/efficiency.ts";
import { fitLss, predictLss } from "../src/engine/fit.ts";
import { lssGradientTime, lssProgramTime, migrate, programPhi, programTime } from "../src/engine/gradient.ts";
import { integrate, noiseSd } from "../src/engine/integrate.ts";
import { viscosityCp } from "../src/engine/mobilephase.ts";
import { emg, gaussian } from "../src/engine/peakshape.ts";
import { ionizationFactor, retentionFactor } from "../src/engine/retention.ts";
import { makeRng } from "../src/engine/rng.ts";
import { computeBands, simulateRun } from "../src/engine/simulate.ts";
import { column, instrument, method, params, sample, solute, soluteMap } from "./fixtures.ts";

const quiet = { ...instrument, uvNoiseMau: 1e-6 };

describe("retention", () => {
  it("LSS: ln k falls linearly with phi", () => {
    const c = { p: params(5, 10), ion: undefined, tempC: 30, pH: 3 };
    expect(Math.log(retentionFactor(c, 0.3))).toBeCloseTo(2, 10);
    expect(Math.log(retentionFactor(c, 0.5))).toBeCloseTo(0, 10);
  });
  it("Neue-Kuss reduces to LSS when S2 is zero and curves upward otherwise", () => {
    const lss = { p: params(5, 10), ion: undefined, tempC: 30, pH: 3 };
    const nk = { p: params(5, 10, { S2: 1 }), ion: undefined, tempC: 30, pH: 3 };
    expect(retentionFactor(nk, 0)).toBeCloseTo(retentionFactor(lss, 0), 10);
    expect(retentionFactor(nk, 0.5)).toBeGreaterThan(retentionFactor(lss, 0.5));
  });
  it("van 't Hoff: exothermic transfer lowers k on heating by the expected factor", () => {
    const c = (tempC: number) => ({ p: params(5, 10, { dH0: -15 }), ion: undefined, tempC, pH: 3 });
    const ratio = retentionFactor(c(50), 0.4) / retentionFactor(c(30), 0.4);
    const expected = Math.exp((15 / 8.314462618e-3) * (1 / 323.15 - 1 / 303.15));
    expect(ratio).toBeCloseTo(expected, 10);
    expect(ratio).toBeLessThan(1);
  });
  it("an acid is half ionized at its apparent pKa", () => {
    const ion = { kind: "acid" as const, pKa: 4, dpKaDphi: 0, ionizedRatio: 0, prov: { basis: "assumed" as const, ref: "t" } };
    expect(ionizationFactor(ion, 4, 0)).toBeCloseTo(0.5, 12);
    expect(ionizationFactor(ion, 2, 0)).toBeCloseTo(1 / 1.01, 10);
    expect(ionizationFactor({ ...ion, kind: "base" }, 6, 0)).toBeCloseTo(1 / 1.01, 10);
  });
});

describe("gradient migration", () => {
  const t0 = 1.5;
  it("isocratic: tR = t0 (1 + k) and sigma = tR / sqrt(N)", () => {
    const k = 4;
    const N = 10000;
    const r = migrate({ program: [{ t: 0, phi: 0.5 }], t0, tD: 1, k: () => k, dlnk: () => -10, h: () => 1 / N, v0: 0, tMax: 60 });
    expect(r.tR).toBeCloseTo(t0 * (1 + k), 6);
    expect(r.sigma).toBeCloseTo((t0 * (1 + k)) / Math.sqrt(N), 6);
  });
  it("linear gradient with dwell matches the closed-form LSS solution", () => {
    for (const [lnkw, S, tG, tD] of [[6, 12, 20, 1], [9, 20, 10, 0.3], [4, 8, 40, 2], [7, 15, 5, 0]] as const) {
      const program = [{ t: 0, phi: 0.05 }, { t: tG, phi: 0.95 }];
      const num = predictLss(lnkw, S, program, t0, tD);
      const exact = lssGradientTime(lnkw, S, 0.05, 0.9 / tG, t0, tD);
      expect(num).toBeCloseTo(exact, 3);
    }
  });
  it("the exact segment-wise LSS solution agrees with numerical migration on a multi-step programme", () => {
    const program = [{ t: 0, phi: 0.2 }, { t: 1, phi: 0.2 }, { t: 5, phi: 0.25 }, { t: 15, phi: 0.3 }, { t: 25, phi: 0.4 }];
    for (const [lnkw, S] of [[3, 9], [5, 14], [7, 18], [1, 6]] as const) {
      const num = migrate({ program, t0, tD: 0.8, k: (phi) => Math.exp(lnkw - S * phi), dlnk: () => -S, h: () => 0, v0: 0, tMax: 500 });
      expect(lssProgramTime(lnkw, S, program, t0, 0.8)).toBeCloseTo(num.tR, 3);
    }
  });
  it("quadrature solver agrees with the exact LSS solution and with migration for a curved model", () => {
    const program = [{ t: 0, phi: 0.05 }, { t: 2, phi: 0.05 }, { t: 22, phi: 0.6 }, { t: 25, phi: 0.95 }];
    expect(programTime((phi) => Math.exp(6 - 14 * phi), program, t0, 0.7)).toBeCloseTo(lssProgramTime(6, 14, program, t0, 0.7), 4);
    const nk = (phi: number) => Math.exp(6 + 2 * Math.log(1 + 1.5 * phi) - (20 * phi) / (1 + 1.5 * phi));
    const num = migrate({ program, t0, tD: 0.7, k: nk, dlnk: () => 0, h: () => 0, v0: 0, tMax: 500 });
    expect(programTime(nk, program, t0, 0.7)).toBeCloseTo(num.tR, 3);
  });
  it("band compression matches Poppe's factor for a linear LSS gradient without dwell", () => {
    const lnkw = 8;
    const S = 15;
    const tG = 20;
    const N = 10000;
    const B = 0.9 / tG;
    const k0 = Math.exp(lnkw - S * 0.05);
    const b = S * B * t0;
    const r = migrate({
      program: [{ t: 0, phi: 0.05 }, { t: tG, phi: 0.95 }],
      t0,
      tD: 0,
      k: (phi) => Math.exp(lnkw - S * phi),
      dlnk: () => -S,
      h: () => 1 / N,
      v0: 0,
      tMax: 60,
    });
    const ke = k0 / (1 + b * k0);
    const p = (k0 * b) / (1 + k0);
    const G = Math.sqrt((1 + p + (p * p) / 3) / ((1 + p) * (1 + p)));
    expect(r.kElution).toBeCloseTo(ke, 3);
    expect(r.sigma / ((G * t0 * (1 + ke)) / Math.sqrt(N))).toBeCloseTo(1, 2);
  });
  it("a band that cannot elute in the run is reported as not eluted", () => {
    const r = migrate({ program: [{ t: 0, phi: 0.1 }], t0, tD: 0, k: () => 500, dlnk: () => 0, h: () => 1e-4, v0: 0, tMax: 10 });
    expect(r.eluted).toBe(false);
    expect(r.x).toBeLessThan(1);
  });
  it("programme interpolation holds the end values", () => {
    const prog = [{ t: 0, phi: 0.1 }, { t: 10, phi: 0.6 }];
    expect(programPhi(prog, -5)).toBe(0.1);
    expect(programPhi(prog, 5)).toBeCloseTo(0.35, 12);
    expect(programPhi(prog, 50)).toBe(0.6);
  });
});

describe("hydrodynamics", () => {
  it("dead time of a 150 x 4.6 mm column at 1 mL/min", () => {
    expect(deadTimeMin(column, 1)).toBeCloseTo(0.65 * Math.PI * 0.23 * 0.23 * 15, 10);
  });
  it("pressure scales with flow and inversely with particle size squared", () => {
    const p1 = pressureBar(column, 1, "MeCN", 0.5, 30);
    const small = { ...column, particleUm: 2.5 };
    expect(pressureBar(column, 2, "MeCN", 0.5, 30) / p1).toBeCloseTo(2, 6);
    expect(pressureBar(small, 1, "MeCN", 0.5, 30)).toBeGreaterThan(3.5 * p1);
  });
  it("water-methanol viscosity passes through a maximum; pure water is near 0.89 cP at 25 degC", () => {
    expect(viscosityCp("MeOH", 0, 25)).toBeCloseTo(0.89, 1);
    expect(viscosityCp("MeOH", 0.45, 25)).toBeGreaterThan(viscosityCp("MeOH", 0, 25));
    expect(viscosityCp("MeOH", 0.45, 25)).toBeGreaterThan(viscosityCp("MeOH", 1, 25));
    expect(viscosityCp("MeCN", 0.5, 50)).toBeLessThan(viscosityCp("MeCN", 0.5, 25));
  });
});

describe("peak shapes", () => {
  it("EMG integrates to one and tends to a Gaussian as tau goes to zero", () => {
    let area = 0;
    for (let t = 0; t < 30; t += 0.001) area += emg(t, 10, 0.1, 0.2) * 0.001;
    expect(area).toBeCloseTo(1, 4);
    expect(emg(10.05, 10, 0.1, 0.0021)).toBeCloseTo(gaussian(10.05, 10, 0.1), 1);
  });
  it("EMG stays finite far out on both sides and for extreme tau", () => {
    for (const tau of [0.003, 0.05, 1, 20]) {
      for (const t of [0, 9, 10, 11, 100]) expect(Number.isFinite(emg(t, 10, 0.1, tau))).toBe(true);
    }
  });
});

// The test traces are almost noise-free, so the small solvent-front disturbance at the dead time would be found; skip it.
const AFTER_FRONT = { minSignalToNoise: 6, tStart: 2.5, smoothHalfWindow: 0 };

describe("integration", () => {
  it("recovers area, plates and symmetry of a clean Gaussian", () => {
    const a = solute("a", params(Math.log(4), 0));
    const run = simulateRun({ method: method(), instrument: quiet, column, sample: sample(["a"]), solutes: soluteMap(a), seed: "x", injRsd: 0 });
    const res = integrate(run.time, run.signal, AFTER_FRONT);
    expect(res.peaks).toHaveLength(1);
    const pk = res.peaks[0]!;
    const truth = run.peaks[0]!;
    expect(pk.tR).toBeCloseTo(truth.tR, 2);
    expect(pk.area / truth.area).toBeCloseTo(1, 2);
    expect(pk.symmetry).toBeCloseTo(1, 1);
    expect(pk.plates / (truth.tR / truth.sigma) ** 2).toBeCloseTo(1, 1);
  });
  it("two peaks at a known spacing give the expected resolution", () => {
    const a = solute("a", params(Math.log(4), 0));
    const b = solute("b", params(Math.log(4.4), 0));
    const run = simulateRun({ method: method(), instrument: quiet, column, sample: sample(["a", "b"]), solutes: soluteMap(a, b), seed: "x", injRsd: 0 });
    const res = integrate(run.time, run.signal, AFTER_FRONT);
    expect(res.peaks).toHaveLength(2);
    const [p1, p2] = run.peaks;
    const expected = (p2!.tR - p1!.tR) / (2 * (p1!.sigma + p2!.sigma));
    expect(res.peaks[1]!.resolution / expected).toBeCloseTo(1, 1);
  });
  it("a co-eluting pair is integrated as one peak with the summed area", () => {
    const a = solute("a", params(Math.log(4), 0));
    const b = solute("b", params(Math.log(4.03), 0));
    const run = simulateRun({ method: method(), instrument: quiet, column, sample: sample(["a", "b"]), solutes: soluteMap(a, b), seed: "x", injRsd: 0 });
    const res = integrate(run.time, run.signal, AFTER_FRONT);
    expect(res.peaks).toHaveLength(1);
    expect(res.peaks[0]!.area / (run.peaks[0]!.area + run.peaks[1]!.area)).toBeCloseTo(1, 2);
  });
  it("noise estimate matches the injected noise and ignores peaks and drift", () => {
    const rng = makeRng(7);
    const y = new Float64Array(5000);
    for (let i = 0; i < y.length; i++) y[i] = 0.01 * i + 50 * Math.exp(-0.5 * ((i - 2500) / 40) ** 2) + 0.2 * rng.gauss();
    expect(noiseSd(y)).toBeCloseTo(0.2, 1);
  });
  it("a blank gives no peaks", () => {
    const run = simulateRun({ method: method(), instrument, column, sample: sample([]), solutes: soluteMap(), seed: "blank" });
    expect(integrate(run.time, run.signal).peaks).toHaveLength(0);
  });
  it("a gradient baseline at low wavelength does not create false peaks", () => {
    const m = method({ modifier: "MeOH", program: [{ t: 0, phi: 0.1 }, { t: 15, phi: 0.9 }], detector: { kind: "uv", nm: 215, rateHz: 10 } });
    const run = simulateRun({ method: m, instrument, column, sample: sample([]), solutes: soluteMap(), seed: "blank2" });
    expect(Math.max(...run.signal)).toBeGreaterThan(20);
    expect(integrate(run.time, run.signal).peaks).toHaveLength(0);
  });
});

describe("simulation", () => {
  const a = solute("a", params(6, 12));
  it("is deterministic for a seed and differs between seeds", () => {
    const go = (seed: string) => simulateRun({ method: method(), instrument, column, sample: sample(["a"]), solutes: soluteMap(a), seed });
    expect(Array.from(go("s1").signal)).toEqual(Array.from(go("s1").signal));
    expect(Array.from(go("s1").signal)).not.toEqual(Array.from(go("s2").signal));
  });
  it("peak area is proportional to amount and inversely proportional to flow", () => {
    const input = { method: method(), instrument: quiet, column, sample: sample(["a"], 50), solutes: soluteMap(a), seed: "x", injRsd: 0 };
    const base = simulateRun(input).peaks[0]!.area;
    expect(simulateRun({ ...input, sample: sample(["a"], 100) }).peaks[0]!.area / base).toBeCloseTo(2, 6);
    expect(simulateRun({ ...input, method: method({ flowMlMin: 2 }) }).peaks[0]!.area / base).toBeCloseTo(0.5, 6);
  });
  it("Beer-Lambert area: eps b n / F", () => {
    const run = simulateRun({ method: method(), instrument: quiet, column, sample: sample(["a"], 60), solutes: soluteMap(a), seed: "x", injRsd: 0 });
    // 60 ug/mL x 5 uL = 0.3 ug = 1e-9 mol; 1e4 x 1 x 1e-9 / 1e-3 L/min = 0.01 AU min = 10 mAU min.
    expect(run.peaks[0]!.area).toBeCloseTo(10, 6);
  });
  it("a strong sample diluent broadens an early peak; a weak one focuses it", () => {
    const early = solute("e", params(5, 12));
    const w = (diluentPhi: number) =>
      computeBands({ method: method({ program: [{ t: 0, phi: 0.3 }], injUl: 50 }), instrument, column, sample: sample(["e"], 50, diluentPhi), solutes: soluteMap(early), seed: "x" })[0]!.sigma;
    expect(w(0.9)).toBeGreaterThan(1.3 * w(0.0));
  });
  it("refuses a method that would exceed the pressure limit", () => {
    expect(() => simulateRun({ method: method({ flowMlMin: 8 }), instrument, column, sample: sample(["a"]), solutes: soluteMap(a), seed: "x" })).toThrow(/Pressure/);
  });
  it("mass selectivity: only ions inside the window respond", () => {
    const b = solute("b", params(5, 12), { monoMass: 314.2246 });
    const run = (mz: number) =>
      simulateRun({ method: method({ detector: { kind: "ms", mz, polarity: "pos", rateHz: 5 } }), instrument, column, sample: sample(["b"]), solutes: soluteMap(b), seed: "x" });
    expect(run(315.23).peaks[0]!.area).toBeGreaterThan(0);
    expect(run(359.2).peaks[0]!.area).toBe(0);
  });
});

describe("student-side fit", () => {
  it("two scouting gradients recover the hidden LSS parameters and predict a third run", () => {
    const t0 = 1.6;
    const tD = 1;
    const truth = { lnkw: 6.5, S: 13 };
    const prog = (tG: number) => [{ t: 0, phi: 0.05 }, { t: tG, phi: 0.95 }];
    const obs = [15, 45].map((tG) => ({ program: prog(tG), t0, tD, tR: predictLss(truth.lnkw, truth.S, prog(tG), t0, tD) }));
    const fit = fitLss(obs)!;
    expect(fit.lnkw).toBeCloseTo(truth.lnkw, 2);
    expect(fit.S).toBeCloseTo(truth.S, 2);
    const iso = [{ t: 0, phi: 0.4 }];
    expect(predictLss(fit.lnkw, fit.S, iso, t0, tD)).toBeCloseTo(predictLss(truth.lnkw, truth.S, iso, t0, tD), 1);
  });
  it("identical runs cannot determine the model", () => {
    const o = { program: [{ t: 0, phi: 0.05 }, { t: 20, phi: 0.95 }], t0: 1.6, tD: 1, tR: 9 };
    expect(fitLss([o, o])).toBeNull();
  });
});

describe("calibration statistics", () => {
  // Worked example checked by hand: x = 1..5, y = 2.1, 3.9, 6.2, 7.8, 10.1.
  const pts = [1, 2, 3, 4, 5].map((x, i) => ({ x, y: [2.1, 3.9, 6.2, 7.8, 10.1][i]! }));
  it("ordinary least squares", () => {
    const f = fitLine(pts)!;
    expect(f.slope).toBeCloseTo(1.99, 10);
    expect(f.intercept).toBeCloseTo(0.05, 10);
    expect(f.sResid).toBeCloseTo(Math.sqrt(0.107 / 3), 10);
    expect(f.r2).toBeCloseTo(1 - 0.107 / 39.708, 10);
    expect(f.seSlope).toBeCloseTo(Math.sqrt(0.107 / 3) / Math.sqrt(10), 10);
  });
  it("inverse prediction interval and ICH limits", () => {
    const f = fitLine(pts)!;
    const u = interpolate(f, 6.02, 1);
    expect(u.x).toBeCloseTo(3, 10);
    expect(u.se).toBeCloseTo((f.sResid / 1.99) * Math.sqrt(1 + 1 / 5), 10);
    const lim = limitsFromCalibration(f, 1);
    expect(lim.ql / lim.dl).toBeCloseTo(10 / 3.3, 10);
    expect(lim.dl).toBeCloseTo((3.3 * f.sResid) / 1.99, 10);
  });
  it("weighted fit of exact data returns the exact line; needs three points", () => {
    const exact = [1, 10, 100, 1000].map((x) => ({ x, y: 3 * x + 2 }));
    const f = fitLine(exact, "1/x2")!;
    expect(f.slope).toBeCloseTo(3, 9);
    expect(f.intercept).toBeCloseTo(2, 9);
    expect(fitLine(exact.slice(0, 2))).toBeNull();
  });
  it("relative standard deviation", () => {
    expect(rsdPct([10, 10.2, 9.8])).toBeCloseTo(2, 10);
  });
});
