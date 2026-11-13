import type { Column, Instrument, Method, RetentionParams, Sample, Solute } from "../src/engine/types.ts";

const prov = { basis: "assumed" as const, ref: "test" };

export const column: Column = {
  id: "c18",
  name: "Test C18",
  chemistry: "C18",
  lengthMm: 150,
  idMm: 4.6,
  particleUm: 5,
  particleType: "FPP",
  porosityTotal: 0.65,
  porosityExt: 0.4,
  vd: { A: 1, B: 5, C: 0.05 },
  pHRange: [2, 8],
  tMaxC: 60,
  pMaxBar: 400,
  prov,
};

export const instrument: Instrument = {
  id: "hplc",
  name: "Test HPLC",
  dwellMl: 1.0,
  extraColVarUl2: 0,
  detTauS: 0,
  pMaxBar: 400,
  pathCm: 1,
  uvNoiseMau: 0.01,
  strayLight: 0,
};

export function params(lnkw: number, S1: number, extra: Partial<RetentionParams> = {}): RetentionParams {
  return { lnkw, S1, S2: 0, phiRange: [0, 1], tRefC: 30, dH0: 0, dH1: 0, prov, ...extra };
}

export function solute(id: string, p: RetentionParams, extra: Partial<Solute> = {}): Solute {
  return {
    id,
    name: id,
    abbr: id,
    mw: 300,
    monoMass: 300,
    retention: { c18: { MeCN: p } },
    uv: [{ nm: 280, eps: 10000, width: 15 }],
    uvProv: prov,
    msResponse: { pos: 1, neg: 1 },
    tailRatio: 0,
    ...extra,
  };
}

export function method(extra: Partial<Method> = {}): Method {
  return {
    columnId: "c18",
    modifier: "MeCN",
    pH: 3,
    tempC: 30,
    flowMlMin: 1,
    program: [{ t: 0, phi: 0.5 }],
    runTimeMin: 20,
    injUl: 5,
    detector: { kind: "uv", nm: 280, rateHz: 10 },
    ...extra,
  };
}

export function sample(ids: string[], ugPerMl = 50, diluentPhi = 0.5): Sample {
  return { id: "s", label: "s", components: ids.map((soluteId) => ({ soluteId, ugPerMl })), diluentPhi };
}

export function soluteMap(...s: Solute[]): Map<string, Solute> {
  return new Map(s.map((x) => [x.id, x]));
}
