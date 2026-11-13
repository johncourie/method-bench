// Peak detection and integration on a sampled trace, the way a data system does
// it: the routine sees only the signal. Co-elution, tailing, drift and noise
// therefore corrupt areas and metrics exactly as they would on an instrument.
// Definitions of resolution, plate number, symmetry factor and signal-to-noise
// follow the harmonized pharmacopoeial chromatography chapter; docs/MODEL.md section 9.

export interface IntegrationParams {
  /** Peaks smaller than this many times the noise are ignored. */
  minSignalToNoise: number;
  /** Ignore everything before this time, min (solvent front). */
  tStart: number;
  /** Smoothing half-window, in points. 0 picks one from the data rate. */
  smoothHalfWindow: number;
}

export const DEFAULT_INTEGRATION: IntegrationParams = { minSignalToNoise: 6, tStart: 0, smoothHalfWindow: 0 };

export interface Peak {
  /** 1-based index in elution order. */
  n: number;
  tR: number;
  height: number;
  area: number;
  /** Area as a percentage of the total integrated area. */
  areaPct: number;
  tStart: number;
  tEnd: number;
  /** Width at half height, min. NaN when a neighbour hides the half-height point. */
  wHalf: number;
  /** Plate number N = 5.54 (tR / w_half)^2. */
  plates: number;
  /** Symmetry factor A_s = w_0.05 / (2 f). */
  symmetry: number;
  /** Resolution to the previous peak, Rs = 1.18 (t2 - t1) / (w_half1 + w_half2). */
  resolution: number;
  /** Signal-to-noise, S/N = 2 H / h. */
  sn: number;
  /** Baseline value at the apex. */
  baseline: number;
  /** Where the peak boundary came from. */
  startKind: "baseline" | "valley";
  endKind: "baseline" | "valley";
  /** The run started or ended before the peak returned to baseline. Its area is not reliable. */
  truncated: boolean;
}

export interface Integration {
  peaks: Peak[];
  /** Standard deviation of the baseline noise, short-term and wander together. */
  noiseSd: number;
  /** Peak-to-peak noise h used for S/N. */
  noisePp: number;
  /** Baseline drawn under the trace, same length as the signal. */
  baseline: Float64Array;
}

function median(a: number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Robust noise standard deviation from second differences (insensitive to drift and to peaks). */
export function noiseSd(y: ArrayLike<number>): number {
  const d: number[] = [];
  for (let i = 2; i < y.length; i++) d.push(Math.abs(y[i]! - 2 * y[i - 1]! + y[i - 2]!));
  // Second difference of white noise has variance 6 sigma^2; MAD to sd is 1.4826.
  return (1.4826 * median(d)) / Math.sqrt(6);
}

/** Moving-average smooth, applied twice (a triangular kernel). */
function smooth(y: ArrayLike<number>, half: number): Float64Array {
  const pass = (src: ArrayLike<number>): Float64Array => {
    const n = src.length;
    const out = new Float64Array(n);
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + src[i]!;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half);
      const b = Math.min(n - 1, i + half);
      out[i] = (pre[b + 1]! - pre[a]!) / (b - a + 1);
    }
    return out;
  };
  return half <= 0 ? Float64Array.from(y as ArrayLike<number>) : pass(pass(y));
}

/** Sliding-window minimum then maximum (morphological opening): follows the baseline under peaks. */
function opening(y: Float64Array, half: number): Float64Array {
  const slide = (src: Float64Array, pick: (a: number, b: number) => boolean): Float64Array => {
    const n = src.length;
    const out = new Float64Array(n);
    const dq: number[] = [];
    let head = 0;
    for (let i = 0; i < n + half; i++) {
      if (i < n) {
        while (dq.length > head && pick(src[i]!, src[dq[dq.length - 1]!]!)) dq.pop();
        dq.push(i);
      }
      const c = i - half;
      if (c >= 0) {
        while (dq[head]! < c - half) head++;
        out[c] = src[dq[head]!]!;
      }
    }
    return out;
  };
  const eroded = slide(y, (a, b) => a <= b);
  return slide(eroded, (a, b) => a >= b);
}

export function integrate(time: ArrayLike<number>, signal: ArrayLike<number>, params: IntegrationParams = DEFAULT_INTEGRATION): Integration {
  const n = signal.length;
  const baseline = new Float64Array(n);
  if (n < 20) return { peaks: [], noiseSd: 0, noisePp: 0, baseline };
  const dt = time[1]! - time[0]!;
  // Light smoothing (about a quarter of a second) is used only to FIND peaks.
  // Heights and widths are measured separately below, so narrow peaks are not flattened.
  const half = params.smoothHalfWindow > 0 ? params.smoothHalfWindow : Math.max(1, Math.round(0.004 / dt));
  const ys = smooth(signal, half);
  // Coarse baseline: opening with a window wider than any peak cluster we expect to resolve.
  const total = time[n - 1]! - time[0]!;
  const openHalf = Math.max(5, Math.round(Math.max(0.75, 0.08 * total) / dt));
  // Opening never rises above the trace, so on noise it rides the local minima.
  // Lift it by the median gap so it runs through the middle of the noise band.
  const coarse = opening(ys, openHalf);
  const gaps: number[] = [];
  for (let i = 0; i < n; i += 2) gaps.push(ys[i]! - coarse[i]!);
  const lift = median(gaps);
  for (let i = 0; i < n; i++) coarse[i]! += lift;
  // Baseline noise as the data system sees it: spread of the trace about the coarse
  // baseline, by a robust estimate that ignores the peaks. Includes slow wander.
  const dev = (src: ArrayLike<number>): number => {
    const d: number[] = [];
    for (let i = 0; i < n; i += 2) d.push(Math.abs(src[i]! - coarse[i]!));
    return 1.4826 * median(d);
  };
  const sdRaw = Math.max(dev(signal), noiseSd(signal));
  const sdSmooth = Math.max(dev(ys), 1e-12);
  const noisePp = 6 * sdRaw;
  const thr = 4 * sdSmooth;
  const iStart = Math.min(n - 1, Math.max(0, Math.ceil(params.tStart / dt)));

  // Cores: runs of points standing clearly above the coarse baseline.
  const cores: Array<[number, number]> = [];
  let start = -1;
  for (let i = iStart; i < n; i++) {
    const above = ys[i]! - coarse[i]! > thr;
    if (above && start < 0) start = i;
    if ((!above || i === n - 1) && start >= 0) {
      cores.push([start, above ? i : i - 1]);
      start = -1;
    }
  }
  // Extend each core outwards to where the trace has come back to the baseline (within
  // one noise standard deviation for several points), so the wings are integrated too.
  // The extension is capped so that wander cannot carry a boundary far from its peak.
  const settle = Math.max(3, half);
  const grown: Array<[number, number]> = [];
  for (const [a0, b0] of cores) {
    const cap = Math.max(4 * (b0 - a0 + 1), Math.round(0.05 / dt));
    let a = a0;
    let quiet = 0;
    while (a > iStart && a0 - a < cap && quiet < settle) {
      a--;
      quiet = ys[a]! - coarse[a]! < sdSmooth ? quiet + 1 : 0;
    }
    let b = b0;
    quiet = 0;
    while (b < n - 1 && b - b0 < cap && quiet < settle) {
      b++;
      quiet = ys[b]! - coarse[b]! < sdSmooth ? quiet + 1 : 0;
    }
    const prev = grown[grown.length - 1];
    if (prev && a <= prev[1] + 1) prev[1] = Math.max(prev[1], b);
    else grown.push([a, b]);
  }

  for (let i = 0; i < n; i++) baseline[i] = coarse[i]!;
  const peaks: Peak[] = [];
  const minHeight = (params.minSignalToNoise * noisePp) / 2; // from S/N = 2H/h

  for (const [a, b] of grown) {
    if (b - a < 4) continue;
    // A cluster that runs into the start or end of the data never reached baseline there.
    const cutStart = a <= iStart && ys[a]! - coarse[a]! > thr;
    const cutEnd = b >= n - 1 && ys[b]! - coarse[b]! > thr;
    // Straight baseline between the cluster ends; level from the good end if one end is cut off.
    const ya = cutStart ? (cutEnd ? coarse[a]! : ys[b]!) : ys[a]!;
    const yb = cutEnd ? (cutStart ? coarse[b]! : ys[a]!) : ys[b]!;
    for (let i = a; i <= b; i++) baseline[i] = ya + ((yb - ya) * (i - a)) / (b - a);
    const net = (i: number): number => ys[i]! - baseline[i]!;

    // Apexes: local maxima, kept only when separated from the previous one by a real valley.
    const maxima: number[] = [];
    for (let i = a + 1; i < b; i++) {
      if (net(i) > net(i - 1) && net(i) >= net(i + 1) && net(i) > minHeight / 2) maxima.push(i);
    }
    if (maxima.length === 0) continue;
    const apexes: number[] = [];
    const valleys: number[] = [];
    for (const m of maxima) {
      const last = apexes[apexes.length - 1];
      if (last === undefined) {
        apexes.push(m);
        continue;
      }
      let v = last;
      for (let i = last; i <= m; i++) if (net(i) < net(v)) v = i;
      const dip = Math.min(net(last), net(m)) - net(v);
      if (dip > 4 * sdSmooth) {
        apexes.push(m);
        valleys.push(v);
      } else if (net(m) > net(last)) {
        apexes[apexes.length - 1] = m;
      }
    }

    for (let j = 0; j < apexes.length; j++) {
      const lo = j === 0 ? a : valleys[j - 1]!;
      const hi = j === apexes.length - 1 ? b : valleys[j]!;
      if (net(apexes[j]!) < minHeight) continue;
      const m = measure(time, signal, baseline, apexes[j]!, lo, hi, dt);
      let area = 0;
      for (let i = lo; i < hi; i++) area += 0.5 * (signal[i]! - baseline[i]! + (signal[i + 1]! - baseline[i + 1]!)) * dt;
      peaks.push({
        n: 0,
        tR: m.tR,
        height: m.height,
        area,
        areaPct: 0,
        tStart: time[lo]!,
        tEnd: time[hi]!,
        wHalf: m.w50,
        plates: 5.54 * (m.tR / m.w50) ** 2,
        symmetry: m.w05 / (2 * m.front05),
        resolution: NaN,
        sn: (2 * m.height) / noisePp,
        baseline: baseline[apexes[j]!]!,
        startKind: j === 0 ? "baseline" : "valley",
        endKind: j === apexes.length - 1 ? "baseline" : "valley",
        truncated: (j === 0 && cutStart) || (j === apexes.length - 1 && cutEnd),
      });
    }
  }

  const totalArea = peaks.reduce((s, p) => s + p.area, 0);
  peaks.forEach((p, i) => {
    p.n = i + 1;
    p.areaPct = totalArea > 0 ? (100 * p.area) / totalArea : 0;
    const prev = peaks[i - 1];
    if (prev) p.resolution = (1.18 * (p.tR - prev.tR)) / (p.wHalf + prev.wHalf);
  });
  return { peaks, noiseSd: sdRaw, noisePp, baseline };
}

/**
 * Apex time, height and widths of one peak, measured on the recorded signal.
 * The signal is smoothed over a window that scales with the peak's own width (about
 * a twelfth of the half-height width), which tames noise at the crossing points, and
 * the small broadening that smoothing adds is then removed from the widths.
 */
function measure(time: ArrayLike<number>, signal: ArrayLike<number>, baseline: Float64Array, apex0: number, lo: number, hi: number, dt: number): { tR: number; height: number; w50: number; w05: number; front05: number } {
  const span = hi - lo + 1;
  const raw = new Float64Array(span);
  for (let i = 0; i < span; i++) raw[i] = signal[lo + i]! - baseline[lo + i]!;
  const pass = (h: number): Float64Array => smooth(raw, h);
  const widthAt = (y: Float64Array, apex: number, level: number): { left: number; right: number } | null => {
    let li = -1;
    for (let i = apex; i > 0; i--) {
      if (y[i - 1]! <= level && y[i]! > level) {
        li = i - 1;
        break;
      }
    }
    let ri = -1;
    for (let i = apex; i < span - 1; i++) {
      if (y[i + 1]! <= level && y[i]! > level) {
        ri = i;
        break;
      }
    }
    if (li < 0 || ri < 0) return null;
    const cross = (i: number): number => {
      const y0 = y[i]!;
      const y1 = y[i + 1]!;
      return y1 === y0 ? i : i + (level - y0) / (y1 - y0);
    };
    return { left: cross(li), right: cross(ri) };
  };
  const apexOf = (y: Float64Array): number => {
    let best = Math.min(span - 2, Math.max(1, apex0 - lo));
    const reach = Math.max(2, Math.round(span / 6));
    for (let i = Math.max(1, best - reach); i <= Math.min(span - 2, best + reach); i++) if (y[i]! > y[best]!) best = i;
    return best;
  };
  // First pass with minimal smoothing to learn the width, second pass with the scaled window.
  let h = 1;
  let y = pass(h);
  let apex = apexOf(y);
  const first = widthAt(y, apex, 0.5 * y[apex]!);
  if (first) {
    h = Math.max(1, Math.floor((first.right - first.left) / 12));
    y = pass(h);
    apex = apexOf(y);
  }
  const height = y[apex]!;
  const den = y[apex - 1]! - 2 * height + y[apex + 1]!;
  const shift = den === 0 ? 0 : (0.5 * (y[apex - 1]! - y[apex + 1]!)) / den;
  const tApex = apex + shift;
  // Variance added by two passes of a (2h + 1)-point moving average, in points squared.
  const kernelVar = (2 * ((2 * h + 1) ** 2 - 1)) / 12;
  const corrected = (w: number, k: number): number => Math.sqrt(Math.max(w * w - k * kernelVar, (w * w) / 4));
  const half = widthAt(y, apex, 0.5 * height);
  const foot = widthAt(y, apex, 0.05 * height);
  // For a Gaussian, width at fraction f of height is sigma * sqrt(-8 ln f): 5.545 at half height, 23.97 at 5%.
  const w50 = half ? corrected(half.right - half.left, 5.545) * dt : NaN;
  const w05 = foot ? corrected(foot.right - foot.left, 23.97) * dt : NaN;
  const front05 = foot ? ((tApex - foot.left) * (foot ? corrected(foot.right - foot.left, 23.97) / (foot.right - foot.left) : 1)) * dt : NaN;
  return { tR: time[lo]! + tApex * dt, height, w50, w05, front05 };
}
