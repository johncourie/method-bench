// Migration of one solute band through the column under any piecewise-linear
// programme, with dwell delay, on-column focusing of the injection plug, plate
// dispersion and gradient band compression. docs/MODEL.md section 4.
//
// State: x, the band centre as a fraction of column length, and v, the spatial
// variance of the band in the same fractional units.
//   dx/dt = u            u = 1 / (t0 (1 + k))
//   dv/dt = u h + 2 v du/dx
// h is plate height over column length at local conditions. du/dx is the
// velocity gradient along the band: negative in a rising gradient because the
// rear of the band sits in stronger solvent, which is what compresses the band.

import type { GradientPoint } from "./types.ts";

/** Composition delivered by the pump at time t (no delay). */
export function programPhi(program: readonly GradientPoint[], t: number): number {
  const first = program[0];
  if (!first) throw new Error("empty gradient programme");
  if (t <= first.t) return first.phi;
  for (let i = 1; i < program.length; i++) {
    const a = program[i - 1]!;
    const b = program[i]!;
    if (t <= b.t) {
      if (b.t === a.t) return b.phi;
      return a.phi + ((b.phi - a.phi) * (t - a.t)) / (b.t - a.t);
    }
  }
  return program[program.length - 1]!.phi;
}

/** Time derivative of the pump programme at time t, per min. */
export function programSlope(program: readonly GradientPoint[], t: number): number {
  for (let i = 1; i < program.length; i++) {
    const a = program[i - 1]!;
    const b = program[i]!;
    if (t > a.t && t <= b.t && b.t > a.t) return (b.phi - a.phi) / (b.t - a.t);
  }
  return 0;
}

export interface MigrationInput {
  program: readonly GradientPoint[];
  /** Column dead time, min. */
  t0: number;
  /** Dwell time, min. */
  tD: number;
  /** k as a function of local composition. */
  k: (phi: number) => number;
  /** d ln k / d phi at local composition. */
  dlnk: (phi: number) => number;
  /** Plate height over column length (1/N) at local composition and retention. */
  h: (phi: number, k: number) => number;
  /** Initial spatial variance of the band (injection plug after focusing). */
  v0: number;
  /** Stop integrating here, min. */
  tMax: number;
  /** Integration steps per dead time. Default 400; coarser is fine for survey maps. */
  stepsPerT0?: number;
}

export interface MigrationResult {
  eluted: boolean;
  /** Retention time, min (tMax if not eluted). */
  tR: number;
  /** Temporal standard deviation at the column outlet, min. */
  sigma: number;
  /** k at the moment of elution. */
  kElution: number;
  /** Lowest and highest composition the band experienced. */
  phiSeen: [number, number];
  /** Fraction of the column travelled (1 if eluted). */
  x: number;
}

export function migrate(m: MigrationInput): MigrationResult {
  const { program, t0, tD, k, dlnk, h } = m;
  let t = 0;
  let x = 0;
  let v = m.v0;
  let lo = Infinity;
  let hi = -Infinity;

  const local = (tt: number, xx: number) => {
    const tau = tt - tD - xx * t0;
    const phi = programPhi(program, tau);
    const kk = k(phi);
    const u = 1 / (t0 * (1 + kk));
    return { tau, phi, kk, u };
  };
  const deriv = (tt: number, xx: number, vv: number): [number, number] => {
    const { tau, phi, kk, u } = local(tt, xx);
    // du/dx = (k / (1 + k)^2) (d ln k / d phi) (d phi / d tau): negative in a rising gradient.
    const dudx = (kk / ((1 + kk) * (1 + kk))) * dlnk(phi) * programSlope(program, tau);
    return [u, u * h(phi, kk) + 2 * vv * dudx];
  };

  // Step no larger than 1/400 of a dead time, and fine enough to resolve programme corners.
  const dtBase = t0 / (m.stepsPerT0 ?? 400);
  let last = local(0, 0);
  while (t < m.tMax) {
    const dt = Math.min(dtBase, m.tMax - t);
    const [k1x, k1v] = deriv(t, x, v);
    const [k2x, k2v] = deriv(t + dt / 2, x + (dt / 2) * k1x, v + (dt / 2) * k1v);
    const [k3x, k3v] = deriv(t + dt / 2, x + (dt / 2) * k2x, v + (dt / 2) * k2v);
    const [k4x, k4v] = deriv(t + dt, x + dt * k3x, v + dt * k3v);
    const dx = (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    const dv = (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    lo = Math.min(lo, last.phi);
    hi = Math.max(hi, last.phi);
    if (x + dx >= 1) {
      const f = (1 - x) / dx;
      const tR = t + f * dt;
      const vEnd = Math.max(v + f * dv, 0);
      const end = local(tR, 1);
      return {
        eluted: true,
        tR,
        sigma: Math.sqrt(vEnd) * t0 * (1 + end.kk),
        kElution: end.kk,
        phiSeen: [Math.min(lo, end.phi), Math.max(hi, end.phi)],
        x: 1,
      };
    }
    x += dx;
    v = Math.max(v + dv, 0);
    t += dt;
    last = local(t, x);
  }
  return {
    eluted: false,
    tR: m.tMax,
    sigma: Math.sqrt(v) * t0 * (1 + last.kk),
    kElution: last.kk,
    phiSeen: [lo, hi],
    x,
  };
}

/**
 * Closed-form retention time for one linear gradient under LSS, used as a golden
 * check and by the student-side fit. Gradient runs from phi0 at slope B (per min)
 * with no upper limit; dwell tD; ln k = lnkw - S phi.
 * While the dwell volume passes, the band moves isocratically at k0.
 */
export function lssGradientTime(lnkw: number, S: number, phi0: number, B: number, t0: number, tD: number): number {
  const k0 = Math.exp(lnkw - S * phi0);
  // Fraction of the column covered before the gradient front catches the band.
  // The front reaches position x at tD + x t0; the band is at x = t / (t0 (1 + k0)).
  const xCatch = tD / (t0 * k0);
  if (xCatch >= 1) return t0 * (1 + k0);
  const b = S * B * t0;
  if (b <= 0) return t0 * (1 + k0);
  // Remaining column fraction (1 - xCatch) is travelled under the gradient.
  return (t0 / b) * Math.log(1 + b * k0 * (1 - xCatch)) + t0 + tD;
}

/**
 * Exact retention time under LSS (ln k = lnk0 - S phi) for any piecewise-linear
 * programme with dwell time tD. In the mobile-phase time coordinate
 * tau = t - tD - x t0 the band advances by d x = d tau / (t0 k(phi(tau))), which
 * integrates in closed form over each linear segment. Returns NaN if the band
 * has not eluted by tau = tauMax.
 */
export function lssProgramTime(lnkw: number, S: number, program: readonly GradientPoint[], t0: number, tD: number, tauMax = 1e4): number {
  let x = 0;
  let tau = -tD;
  // Segment boundaries: before the first point, each programme segment, then a final hold.
  const first = program[0];
  if (!first) throw new Error("empty gradient programme");
  const knots: Array<{ t: number; phi: number }> = [{ t: Math.min(-tD, first.t), phi: first.phi }, ...program];
  for (let i = 0; i <= knots.length - 1; i++) {
    const a = knots[i]!;
    const b = knots[i + 1] ?? { t: tauMax, phi: a.phi };
    const start = Math.max(tau, a.t);
    if (b.t <= start) continue;
    const slope = (b.phi - a.phi) / (b.t - a.t);
    const phiStart = a.phi + slope * (start - a.t);
    const kStart = Math.exp(lnkw - S * phiStart);
    const g = S * slope; // k falls as exp(-g dtau)
    const span = b.t - start;
    const gain = Math.abs(g) < 1e-12 ? span / (t0 * kStart) : Math.expm1(g * span) / (g * t0 * kStart);
    if (x + gain >= 1) {
      const need = (1 - x) * t0 * kStart;
      const d = Math.abs(g) < 1e-12 ? need : Math.log1p(need * g) / g;
      return start + d + tD + t0;
    }
    x += gain;
    tau = b.t;
  }
  return NaN;
}

const GL_X = [0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
const GL_W = [0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

/** Integral of f over [a, b] by 8-point Gauss-Legendre quadrature. */
function gauss8(f: (x: number) => number, a: number, b: number): number {
  const c = (a + b) / 2;
  const hw = (b - a) / 2;
  let s = 0;
  for (let i = 0; i < 4; i++) s += GL_W[i]! * (f(c - hw * GL_X[i]!) + f(c + hw * GL_X[i]!));
  return s * hw;
}

/**
 * Retention time for any retention model k(phi) under a piecewise-linear programme,
 * by quadrature of d x = d tau / (t0 k(phi(tau))) in the mobile-phase time coordinate.
 * Long segments are split so each piece spans at most 2% B or 1 min. NaN if not eluted by tauMax.
 */
export function programTime(k: (phi: number) => number, program: readonly GradientPoint[], t0: number, tD: number, tauMax = 1e4): number {
  const first = program[0];
  if (!first) throw new Error("empty gradient programme");
  const knots: Array<{ t: number; phi: number }> = [{ t: Math.min(-tD, first.t), phi: first.phi }, ...program];
  let x = 0;
  for (let i = 0; i < knots.length; i++) {
    const a = knots[i]!;
    const b = knots[i + 1] ?? { t: tauMax, phi: a.phi };
    const start = Math.max(-tD, a.t);
    if (b.t <= start) continue;
    const slope = (b.phi - a.phi) / (b.t - a.t);
    const phiAt = (t: number): number => a.phi + slope * (t - a.t);
    const rate = (t: number): number => 1 / (t0 * k(phiAt(t)));
    if (slope === 0) {
      const r = rate(start);
      if (x + r * (b.t - start) >= 1) return start + (1 - x) / r + tD + t0;
      x += r * (b.t - start);
      continue;
    }
    const pieces = Math.max(1, Math.ceil(Math.max(Math.abs(b.phi - phiAt(start)) / 0.02, (b.t - start) / 1)));
    const w = (b.t - start) / pieces;
    for (let j = 0; j < pieces; j++) {
      const lo = start + j * w;
      const gain = gauss8(rate, lo, lo + w);
      if (x + gain >= 1) {
        let l = lo;
        let h = lo + w;
        for (let it = 0; it < 50; it++) {
          const mid = (l + h) / 2;
          if (x + gauss8(rate, lo, mid) >= 1) h = mid;
          else l = mid;
        }
        return (l + h) / 2 + tD + t0;
      }
      x += gain;
    }
  }
  return NaN;
}
