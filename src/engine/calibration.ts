// Calibration statistics. docs/MODEL.md section 10.

export type Weighting = "none" | "1/x" | "1/x2";

export interface CalPoint {
  x: number;
  y: number;
}

export interface CalFit {
  weighting: Weighting;
  n: number;
  slope: number;
  intercept: number;
  r2: number;
  /** Residual standard deviation s(y/x), in weighted units when weighted. */
  sResid: number;
  seSlope: number;
  seIntercept: number;
  /** Residuals y - (a + b x), unweighted. */
  residuals: number[];
  /** Weighted mean of x and sum of weighted squared deviations of x; kept for interval estimates. */
  xBar: number;
  sxx: number;
  sumW: number;
}

function weightOf(x: number, w: Weighting): number {
  if (w === "none") return 1;
  if (x <= 0) return 0;
  return w === "1/x" ? 1 / x : 1 / (x * x);
}

/** Least-squares straight line, optionally weighted. Needs at least three points with non-zero weight. */
export function fitLine(points: readonly CalPoint[], weighting: Weighting = "none"): CalFit | null {
  const pts = points.filter((p) => weightOf(p.x, weighting) > 0);
  const n = pts.length;
  if (n < 3) return null;
  let sw = 0;
  let swx = 0;
  let swy = 0;
  for (const p of pts) {
    const w = weightOf(p.x, weighting);
    sw += w;
    swx += w * p.x;
    swy += w * p.y;
  }
  const xBar = swx / sw;
  const yBar = swy / sw;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    const w = weightOf(p.x, weighting);
    sxx += w * (p.x - xBar) ** 2;
    sxy += w * (p.x - xBar) * (p.y - yBar);
    syy += w * (p.y - yBar) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = yBar - slope * xBar;
  let ssr = 0;
  const residuals: number[] = [];
  for (const p of pts) {
    const r = p.y - (intercept + slope * p.x);
    residuals.push(r);
    ssr += weightOf(p.x, weighting) * r * r;
  }
  const sResid = Math.sqrt(ssr / (n - 2));
  return {
    weighting,
    n,
    slope,
    intercept,
    r2: syy === 0 ? 1 : 1 - ssr / syy,
    sResid,
    seSlope: sResid / Math.sqrt(sxx),
    seIntercept: sResid * Math.sqrt(1 / sw + (xBar * xBar) / sxx),
    residuals,
    xBar,
    sxx,
    sumW: sw,
  };
}

/** Two-sided Student t quantile for 95% confidence. */
export function t95(df: number): number {
  const table = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086];
  if (df < 1) return NaN;
  if (df <= 20) return table[df - 1]!;
  // Cornish-Fisher expansion about the normal quantile for larger df.
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df);
}

export interface Interpolated {
  x: number;
  /** Standard error of x. */
  se: number;
  /** 95% confidence half-width. */
  ci95: number;
}

/**
 * Concentration of an unknown from the mean of m replicate responses, with the
 * standard interval for inverse prediction from a straight-line calibration.
 */
export function interpolate(fit: CalFit, yMean: number, m: number): Interpolated {
  const x = (yMean - fit.intercept) / fit.slope;
  const w0 = weightOf(x, fit.weighting) || 1;
  const yBar = fit.intercept + fit.slope * fit.xBar;
  const se = (fit.sResid / Math.abs(fit.slope)) * Math.sqrt(1 / (w0 * m) + 1 / fit.sumW + (yMean - yBar) ** 2 / (fit.slope * fit.slope * fit.sxx));
  return { x, se, ci95: t95(fit.n - 2) * se };
}

/**
 * Detection and quantitation limits from the calibration, ICH Q2(R2): 3.3 sigma / S and 10 sigma / S.
 * sigma is the standard deviation of the response near the limit. For an unweighted fit that is the
 * residual standard deviation. For a weighted fit the residual standard deviation is in weighted
 * units, so it is converted back to response units at the lowest standard, xLow: s / sqrt(w(xLow)).
 */
export function limitsFromCalibration(fit: CalFit, xLow: number): { dl: number; ql: number } {
  const w = weightOf(xLow, fit.weighting);
  const s = w > 0 ? fit.sResid / Math.sqrt(w) : NaN;
  return { dl: (3.3 * s) / Math.abs(fit.slope), ql: (10 * s) / Math.abs(fit.slope) };
}

export function mean(a: readonly number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

/** Sample standard deviation. */
export function stdev(a: readonly number[]): number {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Relative standard deviation, percent. */
export function rsdPct(a: readonly number[]): number {
  return (100 * stdev(a)) / Math.abs(mean(a));
}
