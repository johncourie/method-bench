// What the student derives from their runs: calibration, results, system
// suitability, validation characteristics. All of it is computed from integrated
// peaks and the names the student assigned, never from engine truth.

import { fitLine, interpolate, limitsFromCalibration, mean, rsdPct, type CalFit, type CalPoint, type Interpolated, type Weighting } from "../engine/calibration.ts";
import type { Peak } from "../engine/integrate.ts";
import { makeRng } from "../engine/rng.ts";
import type { Method } from "../engine/types.ts";
import { methodKey, type Executed, type Lab } from "./session.ts";
import type { RunRecord } from "./types.ts";

export type Response = "area" | "height";

export interface CalRow {
  runId: number;
  x: number;
  y: number;
  peak: Peak;
}

export interface Calibration {
  soluteId: string;
  rows: CalRow[];
  fit: CalFit | null;
  dl: number;
  ql: number;
}

/** Runs of one method, in injection order. */
export function runsOfMethod(lab: Lab, method: Method): Executed[] {
  const key = methodKey(method);
  return lab.session.runs.filter((r) => methodKey(r.method) === key).map((r) => lab.execute(r));
}

function isPlainStandard(r: RunRecord): r is RunRecord & { spec: { kind: "standard" } } {
  return r.spec.kind === "standard" && !r.spec.stress;
}

/** Calibration of one analyte from the unstressed standards run under `method`, excluding listed runs. */
export function calibrate(lab: Lab, method: Method, soluteId: string, weighting: Weighting, response: Response, exclude: ReadonlySet<string> = new Set()): Calibration {
  const rows: CalRow[] = [];
  for (const ex of runsOfMethod(lab, method)) {
    const r = ex.record;
    if (!isPlainStandard(r) || exclude.has(`${soluteId}|${r.id}`)) continue;
    const level = r.spec.levels[soluteId];
    if (!level || level <= 0) continue;
    const peak = lab.peakOf(ex, soluteId);
    if (!peak) continue;
    // Response is normalised to the injection volume so standards and samples may differ in it.
    rows.push({ runId: r.id, x: level, y: (peak[response] * method.injUl) / r.method.injUl, peak });
  }
  const pts: CalPoint[] = rows.map((r) => ({ x: r.x, y: r.y }));
  const fit = fitLine(pts, weighting);
  const lim = fit ? limitsFromCalibration(fit, Math.min(...rows.map((r) => r.x))) : { dl: NaN, ql: NaN };
  return { soluteId, rows, fit, dl: lim.dl, ql: lim.ql };
}

export interface SampleResult {
  prep: number;
  runIds: number[];
  /** Mean concentration in the vial, ug/mL. */
  vial: Interpolated;
  /** Content of the product, mg/g. */
  mgPerG: number;
  ci95MgPerG: number;
  /** Whether the mean response lies inside the calibrated range. */
  inRange: boolean;
}

/** Results for every unspiked, unstressed sample preparation run under `method`. */
export function quantify(lab: Lab, method: Method, cal: Calibration, response: Response): SampleResult[] {
  if (!cal.fit) return [];
  const groups = new Map<string, { prep: number; mg: number; ml: number; dilution: number; ys: number[]; ids: number[] }>();
  for (const ex of runsOfMethod(lab, method)) {
    const s = ex.record.spec;
    if (s.kind !== "unknown" || s.stress || Object.values(s.spike ?? {}).some((v) => v > 0)) continue;
    const peak = lab.peakOf(ex, cal.soluteId);
    if (!peak) continue;
    const key = `${s.prep}|${s.mg}|${s.ml}|${s.dilution}`;
    const g = groups.get(key) ?? { prep: s.prep, mg: s.mg, ml: s.ml, dilution: s.dilution, ys: [], ids: [] };
    g.ys.push((peak[response] * method.injUl) / ex.record.method.injUl);
    g.ids.push(ex.record.id);
    groups.set(key, g);
  }
  const xs = cal.rows.map((r) => r.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return [...groups.values()].map((g) => {
    const vial = interpolate(cal.fit!, mean(g.ys), g.ys.length);
    // ug/mL in the vial x dilution x mL / mg sample = ug/mg = mg/g.
    const factor = (g.dilution * g.ml) / g.mg;
    return { prep: g.prep, runIds: g.ids, vial, mgPerG: vial.x * factor, ci95MgPerG: vial.ci95 * factor, inRange: vial.x >= lo && vial.x <= hi };
  });
}

export interface Recovery {
  runId: number;
  addedUgMl: number;
  foundUgMl: number;
  recoveryPct: number;
}

/** Spike recovery: (spiked - unspiked) / added, for spiked preparations with a matching unspiked one. */
export function recoveries(lab: Lab, method: Method, cal: Calibration, response: Response): Recovery[] {
  if (!cal.fit) return [];
  const fit = cal.fit;
  const conc = (ex: Executed): number | null => {
    const p = lab.peakOf(ex, cal.soluteId);
    return p ? ((p[response] * method.injUl) / ex.record.method.injUl - fit.intercept) / fit.slope : null;
  };
  const runs = runsOfMethod(lab, method);
  const out: Recovery[] = [];
  for (const ex of runs) {
    const s = ex.record.spec;
    if (s.kind !== "unknown" || s.stress) continue;
    const added = s.spike?.[cal.soluteId] ?? 0;
    if (added <= 0) continue;
    const base = runs
      .filter((b) => b.record.spec.kind === "unknown" && !b.record.spec.stress && !Object.values(b.record.spec.spike ?? {}).some((v) => v > 0))
      .filter((b) => {
        const t = b.record.spec;
        return t.kind === "unknown" && t.mg === s.mg && t.ml === s.ml && t.dilution === s.dilution;
      })
      .map(conc)
      .filter((v): v is number => v !== null);
    const found = conc(ex);
    if (found === null || base.length === 0) continue;
    out.push({ runId: ex.record.id, addedUgMl: added, foundUgMl: found - mean(base), recoveryPct: (100 * (found - mean(base))) / added });
  }
  return out;
}

export interface Suitability {
  soluteId: string;
  n: number;
  tRMean: number;
  tRRsd: number;
  areaRsd: number;
  plates: number;
  symmetry: number;
  /** Smallest resolution to a neighbouring integrated peak, across replicates. */
  resolutionMin: number;
  runIds: number[];
}

/** Replicate statistics for one analyte over identical standard injections (same method, same vial). */
export function suitability(lab: Lab, method: Method, soluteId: string): Suitability | null {
  const groups = new Map<string, Executed[]>();
  for (const ex of runsOfMethod(lab, method)) {
    const r = ex.record;
    if (!isPlainStandard(r) || r.method.injUl !== method.injUl) continue;
    if (!lab.peakOf(ex, soluteId)) continue;
    const key = JSON.stringify([r.spec.levels, r.spec.prep]);
    groups.set(key, [...(groups.get(key) ?? []), ex]);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 2) return null;
  const peaks = best.map((ex) => lab.peakOf(ex, soluteId)!);
  const resolutions = best.map((ex) => {
    const p = lab.peakOf(ex, soluteId)!;
    const next = ex.integration.peaks.find((q) => q.n === p.n + 1);
    return Math.min(Number.isFinite(p.resolution) ? p.resolution : Infinity, next && Number.isFinite(next.resolution) ? next.resolution : Infinity);
  });
  return {
    soluteId,
    n: best.length,
    tRMean: mean(peaks.map((p) => p.tR)),
    tRRsd: rsdPct(peaks.map((p) => p.tR)),
    areaRsd: rsdPct(peaks.map((p) => p.area)),
    plates: finiteMean(peaks.map((p) => p.plates)),
    symmetry: finiteMean(peaks.map((p) => p.symmetry)),
    resolutionMin: Math.min(...resolutions),
    runIds: best.map((ex) => ex.record.id),
  };
}

/** Mean of the finite values; NaN when a neighbouring peak hides the width in every replicate. */
function finiteMean(a: readonly number[]): number {
  const f = a.filter(Number.isFinite);
  return f.length ? mean(f) : NaN;
}

/** Cosine similarity of two spectra, as a 0 to 1000 match score. */
export function spectralMatch(a: readonly number[], b: readonly number[]): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return aa === 0 || bb === 0 ? 0 : (1000 * ab) / Math.sqrt(aa * bb);
}

export const SPECTRUM_GRID: readonly number[] = Array.from({ length: 96 }, (_, i) => 210 + 2 * i);

/** Below this match score the spectra across a peak are taken to differ. */
export const PURITY_LIMIT = 998;
/** A spectrum must be at least this many times the detector noise at its maximum to be compared. */
const PURITY_MIN_SIGNAL = 150;

/**
 * Peak purity: lowest spectral match between the apex and up to four points on the flanks
 * (near 10% and 50% of height on each side). Spectra carry detector noise, so a flank
 * spectrum is used only when it is strong enough for the comparison to mean something.
 * `match` is NaN when no flank spectrum is strong enough.
 */
export function peakPurity(lab: Lab, ex: Executed, peak: Peak): { match: number; spectra: number[][]; times: number[]; used: number } {
  const half = Number.isFinite(peak.wHalf) ? peak.wHalf / 2 : (peak.tEnd - peak.tStart) / 6;
  // For a Gaussian, 10% of height lies 1.82 half-widths-at-half-height from the apex.
  const times = [peak.tR - 1.82 * half, peak.tR - half, peak.tR, peak.tR + half, peak.tR + 1.82 * half].map((t) => Math.min(peak.tEnd, Math.max(peak.tStart, t)));
  const rng = makeRng(`purity|${ex.record.id}|${peak.n}`);
  const noise = lab.instrument.uvNoiseMau * 2;
  const spectra = times.map((t) => lab.spectrum(ex.record, t, SPECTRUM_GRID).map((v) => v + noise * rng.gauss()));
  const apex = spectra[2]!;
  const usable = [0, 1, 3, 4].filter((i) => Math.max(...spectra[i]!) >= PURITY_MIN_SIGNAL * noise);
  return { match: usable.length ? Math.min(...usable.map((i) => spectralMatch(spectra[i]!, apex))) : NaN, spectra, times, used: usable.length };
}
