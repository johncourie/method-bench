// The student's side of method development: fit a retention model to retention
// times read from their own runs, then predict a new method from that fit.
// Nothing here can see the engine's true parameters.

import type { GradientPoint } from "./types.ts";
import { lssProgramTime, migrate } from "./gradient.ts";

export interface Observation {
  program: readonly GradientPoint[];
  t0: number;
  tD: number;
  tR: number;
}

export interface LssFit {
  lnkw: number;
  S: number;
  /** Root-mean-square error of the fitted retention times, min. */
  rmse: number;
  /** Composition range the observations cover (composition at elution). */
  n: number;
}

/** Retention time under LSS for any programme (exact). NaN if the band does not elute within tMax. */
export function predictLss(lnkw: number, S: number, program: readonly GradientPoint[], t0: number, tD: number, tMax = 600): number {
  const t = lssProgramTime(lnkw, S, program, t0, tD);
  return t <= tMax ? t : NaN;
}

/**
 * Fit ln k = lnkw - S phi to two or more runs by Gauss-Newton on retention time.
 * Returns null when the observations cannot determine both parameters (for
 * example two identical runs).
 */
export function fitLss(obs: readonly Observation[]): LssFit | null {
  if (obs.length < 2) return null;
  let lnkw = 4;
  let S = 8;
  // Start from the best point of a coarse grid: the surface has a long curved valley.
  let best = Infinity;
  for (let a = 0; a <= 14; a += 1) {
    for (let s = 1; s <= 40; s += 1.5) {
      const e = sse(obs, a, s);
      if (e < best) {
        best = e;
        lnkw = a;
        S = s;
      }
    }
  }
  let lambda = 1e-3;
  for (let iter = 0; iter < 60; iter++) {
    const r = residuals(obs, lnkw, S);
    if (r.some(Number.isNaN)) return null;
    const h = 1e-4;
    const ra = residuals(obs, lnkw + h, S);
    const rs = residuals(obs, lnkw, S + h);
    let jaa = 0;
    let jas = 0;
    let jss = 0;
    let ga = 0;
    let gs = 0;
    for (let i = 0; i < r.length; i++) {
      const da = (ra[i]! - r[i]!) / h;
      const ds = (rs[i]! - r[i]!) / h;
      jaa += da * da;
      jas += da * ds;
      jss += ds * ds;
      ga += da * r[i]!;
      gs += ds * r[i]!;
    }
    const a11 = jaa * (1 + lambda);
    const a22 = jss * (1 + lambda);
    const det = a11 * a22 - jas * jas;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
    const dA = (-ga * a22 + gs * jas) / det;
    const dS = (-gs * a11 + ga * jas) / det;
    const cur = r.reduce((s, v) => s + v * v, 0);
    const trial = sse(obs, lnkw + dA, S + dS);
    if (trial < cur) {
      lnkw += dA;
      S += dS;
      lambda = Math.max(lambda / 5, 1e-9);
      if (Math.abs(dA) < 1e-9 && Math.abs(dS) < 1e-9) break;
    } else {
      lambda *= 8;
      if (lambda > 1e8) break;
    }
  }
  const r = residuals(obs, lnkw, S);
  // The fit is only meaningful when the runs put the peak at different compositions and the
  // result is a physically possible retention model. Replicate runs, a peak that leaves before
  // the gradient reaches it in every run, or a badly wrong column volume all fail here.
  const phis = obs.map((o) => elutionPhi(o));
  if (Math.max(...phis) - Math.min(...phis) < 0.01) return null;
  if (!(S > 1 && S < 45 && lnkw > -3 && lnkw < 16)) return null;
  if (obs.some((o) => o.tR <= o.t0 * 1.02)) return null;
  return { lnkw, S, rmse: Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length), n: obs.length };
}

function residuals(obs: readonly Observation[], lnkw: number, S: number): number[] {
  return obs.map((o) => predictLss(lnkw, S, o.program, o.t0, o.tD) - o.tR);
}

function sse(obs: readonly Observation[], lnkw: number, S: number): number {
  let s = 0;
  for (const r of residuals(obs, lnkw, S)) s += Number.isNaN(r) ? 1e6 : r * r;
  return s;
}

/** Retention time and peak standard deviation predicted from a fitted LSS model and an assumed plate number. */
export function predictBand(lnkw: number, S: number, plates: number, program: readonly GradientPoint[], t0: number, tD: number, tMax: number, stepsPerT0 = 400): { tR: number; sigma: number } | null {
  const r = migrate({ program, t0, tD, k: (phi) => Math.exp(lnkw - S * phi), dlnk: () => -S, h: () => 1 / plates, v0: 0, tMax, stepsPerT0 });
  return r.eluted ? { tR: r.tR, sigma: r.sigma } : null;
}

/** Resolution of adjacent Gaussian peaks from retention times and standard deviations (equal to 1.18 dt / sum of half-height widths). */
export function resolutionOf(a: { tR: number; sigma: number }, b: { tR: number; sigma: number }): number {
  return Math.abs(b.tR - a.tR) / (2 * (a.sigma + b.sigma));
}

/** Composition at the column outlet at the moment the peak eluted. */
function elutionPhi(o: Observation): number {
  const tau = o.tR - o.tD - o.t0;
  const first = o.program[0]!;
  if (tau <= first.t) return first.phi;
  for (let i = 1; i < o.program.length; i++) {
    const a = o.program[i - 1]!;
    const b = o.program[i]!;
    if (tau <= b.t) return b.t === a.t ? b.phi : a.phi + ((b.phi - a.phi) * (tau - a.t)) / (b.t - a.t);
  }
  return o.program[o.program.length - 1]!.phi;
}
