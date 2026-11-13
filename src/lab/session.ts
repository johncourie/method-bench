// The student's lab notebook: every injection made, and everything derived from it.
// Results are never stored. They are recomputed from the record, so a saved session
// reproduces exactly on any machine.

import type { Column, Instrument, Method, RunResult, Solute } from "../engine/types.ts";
import { deadVolumeMl } from "../engine/efficiency.ts";
import { integrate, type Integration, type IntegrationParams, type Peak } from "../engine/integrate.ts";
import { simulateRun, spectrumAt, type RunInput } from "../engine/simulate.ts";
import { REEQUILIBRATION_CV } from "../engine/tunables.ts";
import { toSample, vialContents } from "./samples.ts";
import type { AnalysisSettings, CaseDef, RunRecord, SampleSpec, Session } from "./types.ts";

export interface Catalog {
  solutes: ReadonlyMap<string, Solute>;
  columns: ReadonlyMap<string, Column>;
  instruments: ReadonlyMap<string, Instrument>;
  cases: ReadonlyMap<string, CaseDef>;
}

export interface Executed {
  record: RunRecord;
  result: RunResult;
  integration: Integration;
  /** Name assigned by the student to each integrated peak, by peak number. */
  names: Map<number, string>;
}

export function defaultAnalysis(c: CaseDef): AnalysisSettings {
  return {
    refRun: null,
    solute: c.analytes[0] ?? "",
    weighting: "none",
    response: "area",
    excluded: [],
    integration: { minSignalToNoise: 6, tStart: 0 },
    criteria: { areaRsd: 2.0, resolution: 2.0, symLo: 0.8, symHi: 1.8, plates: 2000 },
  };
}

export function newSession(c: CaseDef, seed: string, instrumentId: string): Session {
  return { version: 1, caseId: c.id, seed, instrumentId, runs: [], nextId: 1, debriefAt: null, student: "", analysis: defaultAnalysis(c) };
}

const keyCache = new WeakMap<Method, string>();
/** Two methods are the same separation when everything but the injection volume matches. */
export function methodKey(m: Method): string {
  let k = keyCache.get(m);
  if (k === undefined) {
    k = JSON.stringify([m.columnId, m.modifier, m.pH, m.buffer ?? "", m.tempC, m.flowMlMin, m.program, m.runTimeMin, m.detector]);
    keyCache.set(m, k);
  }
  return k;
}

/** Retention-time window used to carry a peak name between runs of the same method. */
export const ID_WINDOW = 0.025;

export class Lab {
  private cache = new Map<number, { result: RunResult; integration: Integration }>();

  constructor(
    readonly catalog: Catalog,
    public session: Session,
  ) {}

  get case(): CaseDef {
    const c = this.catalog.cases.get(this.session.caseId);
    if (!c) throw new Error(`unknown case ${this.session.caseId}`);
    return c;
  }

  get instrument(): Instrument {
    const i = this.catalog.instruments.get(this.session.instrumentId);
    if (!i) throw new Error(`unknown instrument ${this.session.instrumentId}`);
    return i;
  }

  column(id: string): Column {
    const c = this.catalog.columns.get(id);
    if (!c) throw new Error(`unknown column ${id}`);
    return c;
  }

  runInput(r: RunRecord): RunInput {
    const contents = vialContents(this.case, this.session.seed, r.spec, this.catalog.solutes);
    return {
      method: r.method,
      instrument: this.instrument,
      column: this.column(r.method.columnId),
      sample: toSample(`run${r.id}`, contents, r.diluentPhi),
      solutes: this.catalog.solutes,
      seed: `${this.session.caseId}|${this.session.seed}|run|${r.id}`,
    };
  }

  /** Add an injection to the notebook. Throws with a readable message if the method cannot run. */
  inject(method: Method, spec: SampleSpec, diluentPhi: number, note = ""): RunRecord {
    const record: RunRecord = { id: this.session.nextId, method: structuredClone(method), spec: structuredClone(spec), diluentPhi, labels: [], note };
    const size = (record.method.runTimeMin * 60 * record.method.detector.rateHz) / 1e6;
    if (size > 1) throw new Error("That run would record more than a million data points. Shorten the run or lower the data rate.");
    const result = simulateRun(this.runInput(record)); // throws on faults before anything is recorded
    this.session.runs.push(record);
    this.session.nextId += 1;
    this.cache.set(record.id, { result, integration: integrate(result.time, result.signal, this.integrationFor(record)) });
    return record;
  }

  private integrationFor(r: RunRecord): IntegrationParams {
    // Skip the unretained disturbance unless the student asked for an explicit start.
    const t0 = deadVolumeMl(this.column(r.method.columnId)) / r.method.flowMlMin;
    const a = this.session.analysis.integration;
    return { minSignalToNoise: a.minSignalToNoise, tStart: Math.max(a.tStart, 0.6 * t0), smoothHalfWindow: 0 };
  }

  execute(r: RunRecord): Executed {
    let hit = this.cache.get(r.id);
    if (!hit) {
      const result = simulateRun(this.runInput(r));
      hit = { result, integration: integrate(result.time, result.signal, this.integrationFor(r)) };
      this.cache.set(r.id, hit);
    }
    return { record: r, ...hit, names: this.namesFor(r, hit.integration.peaks) };
  }

  reintegrate(): void {
    this.cache.clear();
  }

  run(id: number): Executed | undefined {
    const r = this.session.runs.find((x) => x.id === id);
    return r ? this.execute(r) : undefined;
  }

  /**
   * Names for the peaks of a run. Each label names the one peak nearest to it, if that
   * peak lies within the retention window. A label given in this run wins over one
   * carried from another run of the same method, which is what an identification
   * table in a data system does.
   */
  private namesFor(r: RunRecord, peaks: readonly Peak[]): Map<number, string> {
    const key = methodKey(r.method);
    const best = new Map<number, { soluteId: string; d: number; own: boolean }>();
    for (const other of this.session.runs) {
      if (methodKey(other.method) !== key) continue;
      const own = other.id === r.id;
      for (const l of other.labels) {
        const peak = nearestPeak(peaks, l.tR);
        if (!peak) continue;
        const d = Math.abs(l.tR - peak.tR) / peak.tR;
        if (d > ID_WINDOW) continue;
        const cur = best.get(peak.n);
        if (!cur || (own && !cur.own) || (own === cur.own && d < cur.d)) best.set(peak.n, { soluteId: l.soluteId, d, own });
      }
    }
    const names = new Map<number, string>();
    for (const [n, b] of best) if (b.soluteId !== "") names.set(n, b.soluteId);
    return names;
  }

  /** Assign or clear the name of the peak at tR in one run. Only that peak's own label is replaced. */
  label(runId: number, tR: number, soluteId: string): void {
    const r = this.session.runs.find((x) => x.id === runId);
    if (!r) return;
    const peaks = this.execute(r).integration.peaks;
    const target = nearestPeak(peaks, tR);
    r.labels = r.labels.filter((l) => nearestPeak(peaks, l.tR) !== target);
    r.labels.push({ tR: target?.tR ?? tR, soluteId });
  }

  /** The peak of a run carrying a given name, if exactly one does. */
  peakOf(ex: Executed, soluteId: string): Peak | undefined {
    const hits = ex.integration.peaks.filter((p) => ex.names.get(p.n) === soluteId);
    return hits.length === 1 ? hits[0] : undefined;
  }

  /** Diode-array spectrum at a time in a run, with detector noise. */
  spectrum(r: RunRecord, t: number, grid: readonly number[]): number[] {
    return spectrumAt(this.runInput(r), t, grid);
  }

  /** Instrument time and solvent consumed so far. */
  ledger(): { injections: number; minutes: number; solventMl: number } {
    let minutes = 0;
    let solventMl = 0;
    for (const r of this.session.runs) {
      const col = this.column(r.method.columnId);
      const gradient = r.method.program.some((p) => p.phi !== r.method.program[0]!.phi);
      const reeq = gradient ? (REEQUILIBRATION_CV * deadVolumeMl(col)) / r.method.flowMlMin : 0;
      minutes += r.method.runTimeMin + reeq;
      solventMl += (r.method.runTimeMin + reeq) * r.method.flowMlMin;
    }
    return { injections: this.session.runs.length, minutes, solventMl };
  }
}

/** The integrated peak closest in time to t. */
function nearestPeak(peaks: readonly Peak[], t: number): Peak | undefined {
  let best: Peak | undefined;
  for (const p of peaks) if (!best || Math.abs(p.tR - t) < Math.abs(best.tR - t)) best = p;
  return best;
}

/** Serialize for download or local storage. */
export function saveSession(s: Session): string {
  return JSON.stringify(s);
}

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const AGENTS = ["heat", "acid", "base", "peroxide", "light"];

function checkLevels(v: unknown, catalog: Catalog, what: string): void {
  if (!isObj(v)) throw new Error(`${what} is not a list of concentrations.`);
  for (const [id, x] of Object.entries(v)) if (!catalog.solutes.has(id) || !isNum(x, 0, 1e6)) throw new Error(`${what} has an unknown compound or a bad concentration.`);
}

function checkStress(v: unknown, what: string): void {
  if (v === undefined) return;
  if (!isObj(v) || !AGENTS.includes(v.agent as string) || !isNum(v.hours, 0, 1e5) || !isNum(v.tempC, -80, 300)) throw new Error(`${what} has a bad stress condition.`);
}

/** Limits on a method, shared by the editor and by notebook loading. */
export const METHOD_LIMITS = { flow: [0.01, 10], tempC: [5, 100], runTime: [0.1, 240], inj: [0.01, 500], rate: [0.5, 100], nm: [190, 800], mz: [50, 2000], steps: 40 } as const;

function checkMethod(m: unknown, c: CaseDef, catalog: Catalog, what: string): void {
  const L = METHOD_LIMITS;
  if (!isObj(m)) throw new Error(`${what} has no method.`);
  if (typeof m.columnId !== "string" || !catalog.columns.has(m.columnId)) throw new Error(`${what} uses a column this version does not have.`);
  if (!c.modifiers.includes(m.modifier as never)) throw new Error(`${what} uses a solvent this case does not have.`);
  // Notebooks saved before buffers existed take the case's usual buffer.
  if (m.buffer === undefined) m.buffer = c.defaultMethod.buffer;
  if (m.buffer !== undefined && (typeof m.buffer !== "string" || !c.buffers.includes(m.buffer))) throw new Error(`${what} uses a buffer this case does not have.`);
  if (!isNum(m.pH, 0, 14) || !isNum(m.tempC, L.tempC[0], L.tempC[1]) || !isNum(m.flowMlMin, L.flow[0], L.flow[1]) || !isNum(m.runTimeMin, L.runTime[0], L.runTime[1]) || !isNum(m.injUl, L.inj[0], L.inj[1])) throw new Error(`${what} has a method setting out of range.`);
  if (!Array.isArray(m.program) || m.program.length < 1 || m.program.length > L.steps) throw new Error(`${what} has a bad gradient table.`);
  for (const p of m.program) if (!isObj(p) || !isNum(p.t, 0, 1e4) || !isNum(p.phi, 0, 1)) throw new Error(`${what} has a bad gradient table.`);
  const d = m.detector;
  if (!isObj(d) || !isNum(d.rateHz, L.rate[0], L.rate[1])) throw new Error(`${what} has a bad detector setting.`);
  if (d.kind === "uv" ? !isNum(d.nm, L.nm[0], L.nm[1]) : d.kind === "ms" ? !isNum(d.mz, L.mz[0], L.mz[1]) || (d.polarity !== "pos" && d.polarity !== "neg") : true) throw new Error(`${what} has a bad detector setting.`);
}

/**
 * Read a notebook from text. Every field is checked, so a damaged, hand-edited or
 * out-of-date file is refused with a message instead of breaking the page later.
 */
export function loadSession(text: string, catalog: Catalog): Session {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file is not a Method Bench notebook.");
  }
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.runs) || typeof raw.seed !== "string" || typeof raw.caseId !== "string") throw new Error("This file is not a Method Bench notebook.");
  const c = catalog.cases.get(raw.caseId);
  if (!c) throw new Error("This notebook uses a case this version does not have.");
  if (typeof raw.instrumentId !== "string" || !catalog.instruments.has(raw.instrumentId)) throw new Error("This notebook uses an instrument this version does not have.");
  if (raw.runs.length > 5000) throw new Error("This notebook has too many injections to load.");
  const runs: RunRecord[] = [];
  const seen = new Set<number>();
  for (const [i, r] of raw.runs.entries()) {
    const what = `Injection ${i + 1}`;
    if (!isObj(r) || !isNum(r.id, 1, 1e7) || !Number.isInteger(r.id) || seen.has(r.id)) throw new Error(`${what} has no valid run number.`);
    seen.add(r.id);
    checkMethod(r.method, c, catalog, what);
    if (!isNum(r.diluentPhi, 0, 1)) throw new Error(`${what} has a bad diluent.`);
    const spec = r.spec;
    if (!isObj(spec)) throw new Error(`${what} has no sample.`);
    if (spec.kind === "standard") {
      checkLevels(spec.levels, catalog, what);
      if (!isNum(spec.prep, 1, 1e6)) throw new Error(`${what} has a bad preparation number.`);
      checkStress(spec.stress, what);
    } else if (spec.kind === "unknown") {
      if (!isNum(spec.prep, 1, 1e6) || !isNum(spec.mg, 0.001, 1e6) || !isNum(spec.ml, 0.001, 1e6) || !isNum(spec.dilution, 1, 1e9)) throw new Error(`${what} has a bad sample preparation.`);
      if (spec.spike !== undefined) checkLevels(spec.spike, catalog, what);
      checkStress(spec.stress, what);
    } else if (spec.kind !== "blank") throw new Error(`${what} has an unknown sample type.`);
    const labels = Array.isArray(r.labels) ? r.labels.filter((l): l is { tR: number; soluteId: string } => isObj(l) && isNum(l.tR, 0, 1e4) && typeof l.soluteId === "string").map((l) => ({ tR: l.tR, soluteId: l.soluteId })) : [];
    runs.push({ id: r.id, method: r.method as unknown as Method, spec: spec as unknown as SampleSpec, diluentPhi: r.diluentPhi, labels, note: typeof r.note === "string" ? r.note : "" });
  }
  const d = defaultAnalysis(c);
  const a = isObj(raw.analysis) ? raw.analysis : {};
  const integ = isObj(a.integration) ? a.integration : {};
  const crit = isObj(a.criteria) ? a.criteria : {};
  const num = (v: unknown, lo: number, hi: number, fallback: number): number => (isNum(v, lo, hi) ? v : fallback);
  const analysis: AnalysisSettings = {
    refRun: isNum(a.refRun, 1, 1e7) && seen.has(a.refRun) ? a.refRun : null,
    solute: typeof a.solute === "string" && c.analytes.includes(a.solute) ? a.solute : d.solute,
    weighting: a.weighting === "1/x" || a.weighting === "1/x2" ? a.weighting : "none",
    response: a.response === "height" ? "height" : "area",
    excluded: Array.isArray(a.excluded) ? a.excluded.filter((x): x is string => typeof x === "string").slice(0, 10000) : [],
    integration: { minSignalToNoise: num(integ.minSignalToNoise, 2, 1000, 6), tStart: num(integ.tStart, 0, 1e4, 0) },
    criteria: { areaRsd: num(crit.areaRsd, 0.01, 100, d.criteria.areaRsd), resolution: num(crit.resolution, 0, 100, d.criteria.resolution), symLo: num(crit.symLo, 0, 10, d.criteria.symLo), symHi: num(crit.symHi, 0, 10, d.criteria.symHi), plates: num(crit.plates, 0, 1e7, d.criteria.plates) },
  };
  const maxId = runs.reduce((m, r) => Math.max(m, r.id), 0);
  return {
    version: 1,
    caseId: c.id,
    seed: raw.seed.slice(0, 200),
    instrumentId: raw.instrumentId,
    runs,
    nextId: Math.max(maxId + 1, isNum(raw.nextId, 1, 1e7) ? Math.floor(raw.nextId) : 1),
    debriefAt: isNum(raw.debriefAt, 0, 1e7) ? raw.debriefAt : null,
    student: typeof raw.student === "string" ? raw.student.slice(0, 200) : "",
    analysis,
  };
}
