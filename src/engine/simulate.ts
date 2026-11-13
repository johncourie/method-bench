// One injection: method + instrument + sample in, detector trace and true peaks out.
// docs/MODEL.md sections 4 to 8.

import type { Column, Instrument, Method, RunResult, Sample, Solute, TruePeak } from "./types.ts";
import { deadTimeMin, deadVolumeMl, diffusionCm2S, plateFraction, pressureBar } from "./efficiency.ts";
import { migrate, programPhi } from "./gradient.ts";
import { mobilePhaseAbsorbance } from "./mobilephase.ts";
import { emg } from "./peakshape.ts";
import { dLnKdPhi, retentionFactor, type KContext } from "./retention.ts";
import { makeRng } from "./rng.ts";
import { FLOW_RSD, INJECTION_RSD, MS_BACKGROUND, MS_COUNTS_PER_PMOL, MS_SATURATION_CPS, MS_SOURCE_RSD, MS_WINDOW_DA, OVEN_SD_C, SATURATION_MG_150x46, SOLVENT_FRONT_MAU_MIN_PER_UL, UV_FLICKER_RATIO, UV_FLICKER_TAU_MIN } from "./tunables.ts";

/** Molar absorptivity of a solute at a wavelength, L mol^-1 cm^-1. */
export function epsilonAt(s: Solute, nm: number): number {
  let e = 0;
  for (const b of s.uv) e += b.eps * Math.exp(-0.5 * ((nm - b.nm) / b.width) ** 2);
  return e;
}

const PROTON = 1.007276;

/** m/z of the singly charged ion in the given polarity. */
export function ionMz(s: Solute, polarity: "pos" | "neg"): number {
  return polarity === "pos" ? s.monoMass + PROTON : s.monoMass - PROTON;
}

export interface RunInput {
  method: Method;
  instrument: Instrument;
  column: Column;
  sample: Sample;
  solutes: ReadonlyMap<string, Solute>;
  /** Seed for detector noise and injection imprecision. */
  seed: string;
  /** Relative standard deviation of the injected volume (autosampler precision). */
  injRsd?: number;
}

interface Band extends TruePeak {
  molOnColumn: number;
  solute: Solute;
}

/** Validate a method against the hardware. Returns messages; an empty list means it can run. */
export function methodFaults(method: Method, instrument: Instrument, column: Column): string[] {
  const faults: string[] = [];
  const within = (v: number, lo: number, hi: number): boolean => Number.isFinite(v) && v >= lo && v <= hi;
  if (method.program.length === 0) faults.push("The gradient table is empty.");
  if (method.program.length > 40) faults.push("The gradient table can hold up to 40 steps.");
  if (method.program.some((p, i) => i > 0 && p.t < method.program[i - 1]!.t)) faults.push("Gradient times must increase down the table.");
  if (method.program.some((p) => !within(p.t, 0, 1e4))) faults.push("Gradient times must be zero or more.");
  if (method.program.some((p) => !within(p.phi, 0, 1))) faults.push("%B must lie between 0 and 100.");
  if (!within(method.flowMlMin, 0.01, 10)) faults.push("Flow rate must lie between 0.01 and 10 mL/min.");
  if (!within(method.runTimeMin, 0.1, 240)) faults.push("Run time must lie between 0.1 and 240 min.");
  if (!within(method.injUl, 0.01, 500)) faults.push("Injection volume must lie between 0.01 and 500 \u00b5L.");
  if (!within(method.tempC, 5, 100)) faults.push("Column temperature must lie between 5 and 100 \u00b0C.");
  if (!within(method.detector.rateHz, 0.5, 100)) faults.push("Data rate must lie between 0.5 and 100 Hz.");
  if (faults.length > 0) return faults;
  const pLimit = Math.min(instrument.pMaxBar, column.pMaxBar);
  let pMax = 0;
  for (const p of method.program) pMax = Math.max(pMax, pressureBar(column, method.flowMlMin, method.modifier, p.phi, method.tempC));
  // Viscosity peaks at intermediate composition, so sample the whole programme range too.
  const phis = method.program.map((p) => p.phi);
  const lo = Math.min(...phis);
  const hi = Math.max(...phis);
  for (let i = 0; i <= 20; i++) {
    pMax = Math.max(pMax, pressureBar(column, method.flowMlMin, method.modifier, lo + ((hi - lo) * i) / 20, method.tempC));
  }
  if (pMax > pLimit) {
    faults.push(`Pressure would reach ${pMax.toFixed(0)} bar. The limit for this pump and column is ${pLimit.toFixed(0)} bar.`);
  }
  if (method.tempC > column.tMaxC) faults.push(`This column is rated to ${column.tMaxC} \u00b0C.`);
  if (method.pH < column.pHRange[0] || method.pH > column.pHRange[1]) {
    faults.push(`This column is rated for pH ${column.pHRange[0]} to ${column.pHRange[1]}.`);
  }
  return faults;
}

/** Highest pressure along the programme, bar. */
export function maxPressure(method: Method, column: Column): number {
  const phis = method.program.map((p) => p.phi);
  const lo = Math.min(...phis);
  const hi = Math.max(...phis);
  let pMax = 0;
  for (let i = 0; i <= 20; i++) {
    pMax = Math.max(pMax, pressureBar(column, method.flowMlMin, method.modifier, lo + ((hi - lo) * i) / 20, method.tempC));
  }
  return pMax;
}

/** Compute where and how wide every component elutes. No detector, no noise. */
export function computeBands(input: RunInput, injFactor = 1): Band[] {
  const { method, instrument, column, sample, solutes } = input;
  const t0 = deadTimeMin(column, method.flowMlMin);
  const v0Ml = deadVolumeMl(column);
  const tD = instrument.dwellMl / method.flowMlMin;
  const injMl = (method.injUl * injFactor) / 1000;
  const bedScale = (column.lengthMm / 150) * (column.idMm / 4.6) ** 2;
  const satMg = SATURATION_MG_150x46 * bedScale;
  const bands: Band[] = [];

  for (const comp of sample.components) {
    const s = solutes.get(comp.soluteId);
    if (!s) throw new Error(`unknown solute ${comp.soluteId}`);
    const p = s.retention[column.id]?.[method.modifier];
    if (!p) continue; // no data for this solute on this column and modifier
    const ctx: KContext = { p, ion: p.ionization ?? s.ionization, tempC: method.tempC, pH: method.pH };
    const k = (phi: number) => retentionFactor(ctx, phi);
    const kDiluent = k(sample.diluentPhi);
    // Injection plug: occupies injMl of mobile phase; on entering the bed it is
    // shortened by 1 + k in its own diluent. Uniform plug variance = width^2 / 12.
    const plug = injMl / v0Ml / (1 + kDiluent);
    const res = migrate({
      program: method.program,
      t0,
      tD,
      k,
      dlnk: (phi) => dLnKdPhi(ctx, phi),
      h: (phi) => plateFraction(column, method.flowMlMin, diffusionCm2S(s.mw, method.modifier, phi, method.tempC)),
      v0: (plug * plug) / 12,
      tMax: method.runTimeMin,
    });
    const massMg = (comp.ugPerMl * method.injUl * injFactor) / 1e6;
    const mol = massMg / 1000 / s.mw;
    // Extra-column and detector time-constant broadening add in variance.
    const ecMin2 = instrument.extraColVarUl2 / 1e6 / (method.flowMlMin * method.flowMlMin);
    const detMin = instrument.detTauS / 60;
    let sigma = Math.sqrt(res.sigma * res.sigma + ecMin2);
    // Mass overload: a nonlinear isotherm adds a tail and pulls the apex earlier.
    // A heuristic of the right shape and order of magnitude, not a published
    // isotherm model; see docs/MODEL.md section 7.
    const load = massMg / satMg;
    const wOverload = t0 * res.kElution * Math.sqrt(6 * load) / 4;
    let tau = Math.hypot(s.tailRatio * sigma, detMin);
    let tR = res.tR;
    if (wOverload > 0.3 * sigma) {
      tau = Math.hypot(tau, wOverload);
      tR -= 0.5 * wOverload;
    }
    sigma = Math.max(sigma, 1e-5);
    const extrapolated = res.phiSeen[0] < p.phiRange[0] - 0.02 || res.phiSeen[1] > p.phiRange[1] + 0.02;
    bands.push({
      soluteId: s.id,
      tR,
      sigma,
      tau,
      area: 0,
      kElution: res.kElution,
      eluted: res.eluted,
      extrapolated,
      molOnColumn: mol,
      solute: s,
    });
  }
  return bands;
}

/** Simulate one injection. */
export function simulateRun(input: RunInput): RunResult {
  const { instrument, column } = input;
  let { method } = input;
  const faults = methodFaults(method, instrument, column);
  if (faults.length > 0) throw new Error(faults.join(" "));
  const rng = makeRng(input.seed);
  const injFactor = 1 + (input.injRsd ?? INJECTION_RSD) * rng.gauss();
  // Run-to-run pump and oven variation: what makes replicate retention times scatter.
  const jitter = input.injRsd === 0 ? 1 : 1 + FLOW_RSD * rng.gauss();
  const tempShift = input.injRsd === 0 ? 0 : OVEN_SD_C * rng.gauss();
  input = { ...input, method: { ...method, flowMlMin: method.flowMlMin * jitter, tempC: method.tempC + tempShift } };
  method = input.method;
  const bands = computeBands(input, injFactor);
  const det = method.detector;
  const t0 = deadTimeMin(column, method.flowMlMin);
  const tD = instrument.dwellMl / method.flowMlMin;
  const dt = 1 / (det.rateHz * 60);
  const n = Math.floor(method.runTimeMin / dt) + 1;
  const time = new Float64Array(n);
  const signal = new Float64Array(n);
  for (let i = 0; i < n; i++) time[i] = i * dt;
  const warnings: string[] = [];

  // Electrospray response drifts from injection to injection far more than a UV lamp does.
  const sourceFactor = det.kind === "ms" && input.injRsd !== 0 ? Math.max(0.5, 1 + MS_SOURCE_RSD * rng.gauss()) : 1;
  // Peak areas in detector units x min.
  for (const b of bands) {
    if (det.kind === "uv") {
      // Area = eps * path * mol / flow, with flow in L/min, converted to mAU min.
      b.area = (epsilonAt(b.solute, det.nm) * instrument.pathCm * b.molOnColumn) / (method.flowMlMin / 1000) * 1000;
    } else {
      const match = Math.abs(ionMz(b.solute, det.polarity) - det.mz) <= MS_WINDOW_DA;
      b.area = match ? b.solute.msResponse[det.polarity] * b.molOnColumn * 1e12 * MS_COUNTS_PER_PMOL * sourceFactor : 0;
    }
  }

  // Ion suppression: a co-eluting matrix band lowers electrospray response.
  if (det.kind === "ms") {
    for (const b of bands) {
      let keep = 1;
      for (const m of bands) {
        const strength = m.solute.ionSuppression;
        if (m === b || strength === undefined) continue;
        const pmol = m.molOnColumn * 1e12;
        const overlap = Math.exp(-0.5 * (b.tR - m.tR) ** 2 / (b.sigma ** 2 + m.sigma ** 2 + m.tau ** 2));
        keep *= 1 - Math.min(0.95, strength * (pmol / (pmol + 50))) * overlap;
      }
      b.area *= keep;
    }
  }

  for (const b of bands) {
    if (!b.eluted || b.area === 0) continue;
    const span = 8 * b.sigma + 12 * b.tau;
    const i0 = Math.max(0, Math.floor((b.tR - 8 * b.sigma) / dt));
    const i1 = Math.min(n - 1, Math.ceil((b.tR + span) / dt));
    for (let i = i0; i <= i1; i++) signal[i]! += b.area * emg(time[i]!, b.tR, b.sigma, b.tau);
  }

  if (det.kind === "uv") {
    // Unretained disturbance at the dead time: the sample solvent passing the cell.
    // Its size grows with the injected volume and with the mismatch between diluent and eluent.
    const phiStart = programPhi(method.program, -tD - t0);
    const mismatch = Math.abs(input.sample.diluentPhi - phiStart) + 0.05;
    const front = SOLVENT_FRONT_MAU_MIN_PER_UL * method.injUl * mismatch * Math.exp(-(det.nm - 200) / 40);
    const sFront = Math.max(0.03 * t0, 3 * dt);
    for (let i = Math.max(0, Math.floor((t0 - 8 * sFront) / dt)); i <= Math.min(n - 1, Math.ceil((t0 + 12 * sFront) / dt)); i++) {
      const z = (time[i]! - t0) / sFront;
      // A derivative-shaped blip: down then up, as a refractive-index disturbance looks in a UV cell.
      signal[i]! += (front / (sFront * 2.5066)) * (Math.exp(-0.5 * (z - 0.6) ** 2) - 0.7 * Math.exp(-0.5 * (z + 0.9) ** 2));
    }
    // Mobile-phase background follows the programme, delayed by dwell and dead time, zeroed at injection.
    const base0 = mobilePhaseAbsorbance(method.modifier, phiStart, det.nm) * instrument.pathCm;
    const noise = instrument.uvNoiseMau * Math.sqrt(det.rateHz);
    // Slow baseline noise (lamp, flow cell, pump ripple): a first-order process with a few seconds' memory.
    const keep = Math.exp(-dt / UV_FLICKER_TAU_MIN);
    const drive = instrument.uvNoiseMau * UV_FLICKER_RATIO * Math.sqrt(1 - keep * keep);
    let flicker = instrument.uvNoiseMau * UV_FLICKER_RATIO * rng.gauss();
    let wander = 0;
    const s = instrument.strayLight;
    const baseAu = -Math.log10((Math.pow(10, -base0 / 1000) + s) / (1 + s));
    for (let i = 0; i < n; i++) {
      const phi = programPhi(method.program, time[i]! - tD - t0);
      const background = mobilePhaseAbsorbance(method.modifier, phi, det.nm) * instrument.pathCm;
      const ideal = signal[i]! + background - base0;
      // Stray light bends the response at high total absorbance.
      const totalAu = (ideal + base0) / 1000;
      const observedAu = -Math.log10((Math.pow(10, -totalAu) + s) / (1 + s));
      // Lamp energy falls as the mobile phase absorbs: noise grows with background.
      const noiseGain = Math.pow(10, Math.min(2, background / 1000) / 2);
      flicker = keep * flicker + drive * rng.gauss();
      wander += 0.02 * noise * rng.gauss();
      signal[i] = (observedAu - baseAu) * 1000 + noiseGain * (noise * rng.gauss() + flicker) + wander;
    }
    const peakAu = bands.reduce((m, b) => (b.eluted ? Math.max(m, b.area / (b.sigma * 2.5066)) : m), 0);
    if (peakAu > 1500) warnings.push("At least one peak exceeds 1500 mAU, where the detector response is no longer linear.");
  } else {
    const bg = MS_BACKGROUND / det.rateHz;
    let saturated = false;
    for (let i = 0; i < n; i++) {
      // Ion current in counts per second, limited by the detector at high rates.
      const rate = signal[i]! / 60;
      if (rate > 0.3 * MS_SATURATION_CPS) saturated = true;
      const seen = rate / (1 + rate / MS_SATURATION_CPS);
      const mean = seen / det.rateHz + bg;
      signal[i] = Math.max(0, mean + Math.sqrt(mean) * rng.gauss()) * det.rateHz;
    }
    if (saturated) warnings.push("The ion signal is high enough for the mass detector to saturate. Response is no longer proportional to amount.");
  }

  // The engine treats the injection as a plug that is focused or broadened at the column head.
  // It does not follow analyte travelling inside a large plug of strong solvent.
  const v0 = deadVolumeMl(column);
  if (method.injUl / 1000 > 0.03 * v0 && input.sample.diluentPhi > programPhi(method.program, 0) + 0.1) {
    warnings.push("Large injection in a diluent stronger than the eluent. On an instrument, early peaks would broaden, split or break through more than shown here.");
  }

  for (const b of bands) {
    if (!b.eluted) continue;
    if (b.extrapolated) warnings.push("Part of this run lies outside the composition range the retention data supports.");
  }
  const late = bands.filter((b) => !b.eluted && b.molOnColumn > 0).length;
  if (late > 0) warnings.push(`${late} component(s) had not left the column when the run ended.`);

  const peaks: TruePeak[] = bands.map((b) => ({
    soluteId: b.soluteId,
    tR: b.tR,
    sigma: b.sigma,
    tau: b.tau,
    area: b.area,
    kElution: b.kElution,
    eluted: b.eluted,
    extrapolated: b.extrapolated,
  }));
  return {
    time,
    signal,
    unit: det.kind === "uv" ? "mAU" : "counts",
    peaks,
    t0,
    tDwell: tD,
    pressureBarMax: maxPressure(method, column),
    warnings: [...new Set(warnings)],
  };
}

/** UV spectrum seen by a diode-array detector at time t, mAU on the given wavelength grid. Noise-free. */
export function spectrumAt(input: RunInput, t: number, grid: readonly number[]): number[] {
  const bands = computeBands(input);
  const out = grid.map(() => 0);
  for (const b of bands) {
    if (!b.eluted) continue;
    const shape = emg(t, b.tR, b.sigma, b.tau);
    if (shape <= 0) continue;
    const scale = (input.instrument.pathCm * b.molOnColumn) / (input.method.flowMlMin / 1000) * 1000 * shape;
    grid.forEach((nm, i) => {
      out[i]! += scale * epsilonAt(b.solute, nm);
    });
  }
  return out;
}
