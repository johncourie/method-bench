// Loads the curated data set and types it. tests/data.test.ts validates every record.

import type { Column, Instrument, Method, Solute } from "../engine/types.ts";
import type { Catalog } from "../lab/session.ts";
import type { CaseDef } from "../lab/types.ts";
import casesJson from "./cases.json";
import checksJson from "./checks.json";
import columnsJson from "./columns.json";
import instrumentsJson from "./instruments.json";
import literatureJson from "./literature.json";
import referencesJson from "./references.json";
import solutesJson from "./solutes.json";

export interface Reference {
  citation: string;
  doi?: string;
  url: string;
  license: string;
}

/** A published method with reported retention times, used to test the engine against the literature. */
export interface LiteratureMethod {
  id: string;
  ref: string;
  caseId: string;
  label: string;
  method: Method;
  /** Dwell volume assumed for the published instrument, mL (rarely reported). */
  dwellMl: number;
  reported: Array<{ soluteId: string; tR: number }>;
  /** True when these retention times were used to fit parameters; false when held out as a test. */
  usedInFit: boolean;
  /** Retention times predicted for this method by a model fitted WITHOUT it (only its column strength fitted). */
  heldOut?: Array<{ soluteId: string; tR: number }>;
  note: string;
}

/** A published number the model was not fitted to, beside the model's value. */
export interface IndependentCheck {
  caseId: string;
  ref: string;
  quantity: string;
  published: string;
  model: string;
  note: string;
}

export const solutes = solutesJson as unknown as Solute[];
export const columns = columnsJson as unknown as Column[];
export const instruments = instrumentsJson as unknown as Instrument[];
export const cases = casesJson as unknown as CaseDef[];
export const references = referencesJson as unknown as Record<string, Reference>;
export const checks = checksJson as unknown as IndependentCheck[];
export const literature = literatureJson as unknown as LiteratureMethod[];

export const catalog: Catalog = {
  solutes: new Map(solutes.map((s) => [s.id, s])),
  columns: new Map(columns.map((c) => [c.id, c])),
  instruments: new Map(instruments.map((i) => [i.id, i])),
  cases: new Map(cases.map((c) => [c.id, c])),
};
