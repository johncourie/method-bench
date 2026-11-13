// The teaching layer: cases, samples the student can prepare, and the session record.

import type { Method, Modifier } from "../engine/types.ts";

export type StressAgent = "heat" | "acid" | "base" | "peroxide" | "light";

/** First-order reaction used for degradation and forced-degradation samples. */
export interface Reaction {
  from: string;
  /** Product solute id, or null when the product is not seen by the detector. */
  to: string | null;
  /** Condition that drives the reaction. */
  agent: StressAgent;
  /** Rate constant at tRefC, per hour. */
  kRefPerH: number;
  tRefC: number;
  /** Activation energy, kJ/mol. */
  eaKJ: number;
  /** Moles of product per mole of reactant consumed. */
  yield: number;
  /** Second product formed mole for mole (for example the acid released by ester hydrolysis). */
  coProduct?: string;
  ref: string;
  basis: "reported" | "fitted" | "assumed";
}

export interface Variant {
  id: string;
  /** Shown to the instructor only. */
  label: string;
  /** Hidden species added to the unknown, mg/g. */
  add?: Record<string, number>;
  /** Stress the product went through before it reached the lab. */
  stress?: { agent: StressAgent; hours: number; tempC: number };
  /** Multiplier on listed analytes (for example an under-strength product). */
  scale?: Record<string, number>;
}

export interface CaseDef {
  id: string;
  title: string;
  /** One-paragraph task statement. */
  brief: string;
  product: {
    name: string;
    /** Label claim, mg/g. */
    claim: Array<{ soluteId: string; mgPerG: number }>;
    /** Default sample preparation. */
    prepMg: number;
    prepMl: number;
  };
  /** Analytes the student reports. Reference standards are available for these. */
  analytes: string[];
  /** Further reference standards that can be bought (degradants, related compounds). */
  extraStandards: string[];
  /** Seeded content ranges in the product, mg/g. */
  composition: Record<string, [number, number]>;
  /** Hidden matrix species, mg/g. */
  matrix: Record<string, [number, number]>;
  /** Seeded extraction recovery range (fraction). */
  recovery: [number, number];
  columns: string[];
  modifiers: Modifier[];
  /** Buffers offered for solvent A (keys of BUFFERS in the engine). */
  buffers: string[];
  pH: { min: number; max: number; step: number; note: string };
  reactions: Reaction[];
  variants: Variant[];
  ratios: Array<{ label: string; num: string; den: string }>;
  /** Weighted sums the student reports, with an optional specification limit, mg/g. */
  totals: Array<{ label: string; terms: Array<{ id: string; factor: number }>; limit?: { kind: "max" | "min"; mgPerG: number; text: string } }>;
  defaultMethod: Method;
  /** Organic fraction of the default sample and standard diluent. */
  diluentPhi: number;
}

export type SampleSpec =
  | { kind: "blank" }
  | { kind: "standard"; levels: Record<string, number>; prep: number; stress?: { agent: StressAgent; hours: number; tempC: number } }
  | {
      kind: "unknown";
      /** Preparation number: each is a fresh weighing with its own small error. */
      prep: number;
      mg: number;
      ml: number;
      dilution: number;
      /** Reference material added before extraction, ug/mL in the final vial at 100% recovery. */
      spike?: Record<string, number>;
      stress?: { agent: StressAgent; hours: number; tempC: number };
    };

/** A peak name the student has assigned, keyed by retention time in that run. */
export interface PeakLabel {
  tR: number;
  soluteId: string;
}

export interface RunRecord {
  id: number;
  method: Method;
  spec: SampleSpec;
  diluentPhi: number;
  labels: PeakLabel[];
  note: string;
}

/** How the student chose to process the data. Part of the notebook, so a report can be reproduced from the file. */
export interface AnalysisSettings {
  /** Run whose method is "the method" for quantitation, suitability and validation. Null means the latest run. */
  refRun: number | null;
  /** Analyte shown on the Quantitation tab and in the validation table. */
  solute: string;
  weighting: "none" | "1/x" | "1/x2";
  response: "area" | "height";
  /** Calibration points left out, as "soluteId|runId". */
  excluded: string[];
  integration: { minSignalToNoise: number; tStart: number };
  criteria: { areaRsd: number; resolution: number; symLo: number; symHi: number; plates: number };
}

export interface Session {
  version: 1;
  caseId: string;
  /** Assignment code. Fixes the unknown and all noise. */
  seed: string;
  instrumentId: string;
  runs: RunRecord[];
  nextId: number;
  /** Run count at the moment the debrief was opened, or null. */
  debriefAt: number | null;
  student: string;
  analysis: AnalysisSettings;
}
