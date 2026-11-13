import { describe, expect, it } from "vitest";
import { catalog } from "../src/data/index.ts";
import { calibrate, quantify, recoveries, suitability } from "../src/lab/analysis.ts";
import { degrade } from "../src/lab/degradation.ts";
import { truthFor, vialContents } from "../src/lab/samples.ts";
import { Lab, loadSession, newSession, saveSession, type Executed } from "../src/lab/session.ts";

/** A careful student: names each integrated peak by injecting single standards (here, shortcut via the true peak list). */
function nameAll(lab: Lab, ex: Executed): void {
  for (const p of ex.integration.peaks) {
    const near = ex.result.peaks.filter((t) => t.eluted && t.area > 0).sort((a, b) => Math.abs(a.tR - p.tR) - Math.abs(b.tR - p.tR))[0];
    if (near && Math.abs(near.tR - p.tR) < 0.15) lab.label(ex.record.id, p.tR, near.soluteId);
  }
}

const cannabis = catalog.cases.get("cannabis")!;
const greentea = catalog.cases.get("greentea")!;

describe("samples and truth", () => {
  it("the same code gives the same unknown; different codes differ; all variants occur", () => {
    expect(truthFor(cannabis, "A-1")).toEqual(truthFor(cannabis, "A-1"));
    expect(truthFor(cannabis, "A-1").mgPerG).not.toEqual(truthFor(cannabis, "A-2").mgPerG);
    const seen = new Set(Array.from({ length: 80 }, (_, i) => truthFor(cannabis, `LAB-${i}`).variant.id));
    expect(seen.size).toBe(cannabis.variants.length);
  });
  it("vial concentration follows weighing, volume, dilution and recovery", () => {
    const t = truthFor(greentea, "T-clean-search-3");
    const base = vialContents(greentea, "T-clean-search-3", { kind: "unknown", prep: 1, mg: 25, ml: 50, dilution: 1 }, catalog.solutes);
    const diluted = vialContents(greentea, "T-clean-search-3", { kind: "unknown", prep: 1, mg: 25, ml: 50, dilution: 5 }, catalog.solutes);
    expect(base.caf! / diluted.caf!).toBeCloseTo(5, 0);
    // Within preparation scatter of the nominal value (caffeine is not touched by any variant stress).
    const nominal = ((t.mgPerG.caf! * 25) / 50) * t.recovery;
    expect(Math.abs(base.caf! / nominal - 1)).toBeLessThan(0.04);
    expect(vialContents(greentea, "x", { kind: "blank" }, catalog.solutes)).toEqual({});
  });
  it("decarboxylation follows the published first-order rate and conserves moles", () => {
    const out = degrade(new Map([["thca", 1]]), cannabis.reactions, "heat", 1, 80);
    expect(out.get("thca")!).toBeCloseTo(Math.exp(-0.18e-3 * 3600), 3);
    expect(out.get("thca")! + out.get("d9thc")!).toBeCloseTo(1, 6);
    // Arrhenius: the 110 degC rate from the 80 degC rate and Ea 88 kJ/mol lands near the published 1.83e-3 /s.
    const hot = degrade(new Map([["thca", 1]]), cannabis.reactions, "heat", 0.1, 110);
    const k110 = -Math.log(hot.get("thca")!) / 360;
    expect(k110 / 1.83e-3).toBeGreaterThan(0.6);
    expect(k110 / 1.83e-3).toBeLessThan(1.6);
  });
});

describe("a scripted student, cannabis case", () => {
  // A code whose hidden situation is the unremarkable lot.
  const seed = "SCRIPT-7";
  const lab = new Lab(catalog, newSession(cannabis, seed, "uhplc"));
  const method = { ...structuredClone(cannabis.defaultMethod), columnId: "cb-c18sp", runTimeMin: 14 };
  const levels = [2, 10, 40, 100, 200];
  for (const x of levels) nameAll(lab, lab.execute(lab.inject(method, { kind: "standard", levels: Object.fromEntries(cannabis.analytes.map((id) => [id, x])), prep: 1 }, 0.8)));
  for (let i = 0; i < 5; i++) lab.inject(method, { kind: "standard", levels: Object.fromEntries(cannabis.analytes.map((id) => [id, 40])), prep: 1 }, 0.8);
  for (const prep of [1, 2, 3]) lab.inject(method, { kind: "unknown", prep, mg: 100, ml: 50, dilution: 1 }, 0.8);
  lab.inject(method, { kind: "unknown", prep: 1, mg: 100, ml: 50, dilution: 1, spike: { cbd: 30 } }, 0.8);
  const truth = truthFor(cannabis, seed);

  it("names carry from the named standards to every run of the same method", () => {
    const last = lab.execute(lab.session.runs[lab.session.runs.length - 1]!);
    expect(last.names.size).toBeGreaterThanOrEqual(6);
    expect(lab.peakOf(last, "cbd")).toBeDefined();
  });

  it("calibration is linear and major analytes match truth x recovery within 3%", () => {
    const cal = calibrate(lab, method, "cbd", "1/x", "area");
    expect(cal.rows.length).toBe(10);
    expect(cal.fit!.r2).toBeGreaterThan(0.999);
    for (const id of ["cbd", "cbda"]) {
      const res = quantify(lab, method, calibrate(lab, method, id, "1/x", "area"), "area");
      expect(res.length).toBe(3);
      const meanFound = res.reduce((a, r) => a + r.mgPerG, 0) / res.length;
      expect(Math.abs(meanFound / (truth.mgPerG[id]! * truth.recovery) - 1), id).toBeLessThan(0.03);
    }
  });

  it("over a hundredfold range, 1/x2 weighting fits the lowest standard better than an unweighted line", () => {
    // The top standards sit where the detector response bends; an unweighted line follows them
    // and misses the bottom of the range in relative terms.
    const lowResidual = (w: "none" | "1/x2"): number => {
      const cal = calibrate(lab, method, "cbda", w, "area");
      const low = cal.rows.find((r) => r.x === 2)!;
      return Math.abs(low.y - (cal.fit!.intercept + cal.fit!.slope * low.x)) / low.y;
    };
    expect(lowResidual("none")).toBeGreaterThan(0.03);
    expect(lowResidual("1/x2")).toBeLessThan(lowResidual("none") / 3);
  });

  it("spike recovery returns the hidden extraction recovery", () => {
    const cal = calibrate(lab, method, "cbd", "none", "area");
    const rec = recoveries(lab, method, cal, "area");
    expect(rec.length).toBe(1);
    expect(Math.abs(rec[0]!.recoveryPct / (100 * truth.recovery) - 1)).toBeLessThan(0.08);
  });

  it("replicate injections give a small area RSD and sensible suitability figures", () => {
    const s = suitability(lab, method, "cbn")!;
    expect(s.n).toBe(6);
    expect(s.areaRsd).toBeLessThan(1.5);
    expect(s.tRRsd).toBeLessThan(0.2);
    expect(s.symmetry).toBeGreaterThan(0.9);
    expect(s.symmetry).toBeLessThan(1.6);
    expect(s.plates).toBeGreaterThan(5000);
  });

  it("a saved notebook reproduces every number exactly", () => {
    const copy = new Lab(catalog, loadSession(saveSession(lab.session), catalog));
    for (const r of lab.session.runs) {
      const a = lab.execute(r);
      const b = copy.execute(copy.session.runs.find((x) => x.id === r.id)!);
      expect(b.integration.peaks.map((p) => [p.tR, p.area])).toEqual(a.integration.peaks.map((p) => [p.tR, p.area]));
    }
    expect(lab.ledger().injections).toBe(14);
    expect(truth.variant.id).toBe("clean");
  });

  it("refuses to load something that is not a notebook", () => {
    expect(() => loadSession("{}", catalog)).toThrow();
    expect(() => loadSession(JSON.stringify({ ...lab.session, caseId: "nope" }), catalog)).toThrow();
  });
});

describe("mass selectivity does not separate isomers", () => {
  it("d9-THC, d8-THC, CBD and CBC all answer on m/z 315.2 in positive mode", () => {
    const lab = new Lab(catalog, newSession(cannabis, "MS-1", "uhplc"));
    const method = { ...structuredClone(cannabis.defaultMethod), columnId: "cb-c18sp", detector: { kind: "ms" as const, mz: 315.2, polarity: "pos" as const, rateHz: 5 } };
    const ex = lab.execute(lab.inject(method, { kind: "standard", levels: { cbd: 20, d9thc: 20, d8thc: 20, cbc: 20, cbn: 20, cbda: 20 }, prep: 1 }, 0.8));
    const responding = ex.result.peaks.filter((p) => p.area > 0).map((p) => p.soluteId).sort();
    expect(responding).toEqual(["cbc", "cbd", "d8thc", "d9thc"]);
  });
});
