// Turns what the student prepared into what is actually in the vial.
// The seed fixes the unknown's true content, its hidden variant, and the small
// weighing and dilution errors of each preparation.

import type { Sample, Solute } from "../engine/types.ts";
import { hashString, makeRng } from "../engine/rng.ts";
import { degrade } from "./degradation.ts";
import type { CaseDef, SampleSpec, Variant } from "./types.ts";

/** Relative standard deviation of one sample preparation (weighing, extraction, dilution). */
export const PREP_RSD = 0.008;
/** Relative standard deviation of one standard preparation. */
export const STANDARD_RSD = 0.004;

export interface Truth {
  variant: Variant;
  /** True content of the product, mg/g, including hidden species. */
  mgPerG: Record<string, number>;
  /** True extraction recovery, fraction. */
  recovery: number;
}

/** The hidden truth for a case and assignment code. */
export function truthFor(c: CaseDef, seed: string): Truth {
  const rng = makeRng(`${c.id}|${seed}|truth`);
  const variant = c.variants[hashString(`${c.id}|${seed}|variant`) % c.variants.length]!;
  const mgPerG: Record<string, number> = {};
  for (const [id, [lo, hi]] of Object.entries(c.composition)) mgPerG[id] = rng.range(lo, hi);
  for (const [id, [lo, hi]] of Object.entries(c.matrix)) mgPerG[id] = rng.range(lo, hi);
  for (const [id, f] of Object.entries(variant.scale ?? {})) mgPerG[id] = (mgPerG[id] ?? 0) * f;
  for (const [id, v] of Object.entries(variant.add ?? {})) mgPerG[id] = (mgPerG[id] ?? 0) + v;
  return { variant, mgPerG, recovery: rng.range(c.recovery[0], c.recovery[1]) };
}

/**
 * Content of the product as it reached the lab, mg/g: the true content after whatever
 * happened to the lot before sampling. This is what a correct, recovery-corrected analysis finds.
 */
export function contentAsReceived(c: CaseDef, seed: string, solutes: ReadonlyMap<string, Solute>): Record<string, number> {
  const truth = truthFor(c, seed);
  return stress(truth.mgPerG, c, solutes, truth.variant.stress);
}

const AGENT_TEXT: Record<string, string> = { heat: "heated", acid: "in 0.1 M HCl", base: "in 0.1 M NaOH", peroxide: "in 3% hydrogen peroxide", light: "exposed to light" };

function toMol(ug: Record<string, number>, solutes: ReadonlyMap<string, Solute>): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, v] of Object.entries(ug)) {
    const s = solutes.get(id);
    if (!s) throw new Error(`unknown solute ${id}`);
    m.set(id, v / s.mw);
  }
  return m;
}

function fromMol(mol: ReadonlyMap<string, number>, solutes: ReadonlyMap<string, Solute>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of mol) {
    const s = solutes.get(id);
    if (s && v > 0) out[id] = v * s.mw;
  }
  return out;
}

function stress(ug: Record<string, number>, c: CaseDef, solutes: ReadonlyMap<string, Solute>, s: { agent: Parameters<typeof degrade>[2]; hours: number; tempC: number } | undefined): Record<string, number> {
  if (!s) return ug;
  return fromMol(degrade(toMol(ug, solutes), c.reactions, s.agent, s.hours, s.tempC), solutes);
}

/** Contents of the vial, µg/mL per solute. */
export function vialContents(c: CaseDef, seed: string, spec: SampleSpec, solutes: ReadonlyMap<string, Solute>): Record<string, number> {
  if (spec.kind === "blank") return {};
  if (spec.kind === "standard") {
    const key = Object.entries(spec.levels).sort().map(([k, v]) => `${k}:${v}`).join(",");
    const err = 1 + STANDARD_RSD * makeRng(`${c.id}|${seed}|std|${key}|${spec.prep}`).gauss();
    const ug: Record<string, number> = {};
    for (const [id, v] of Object.entries(spec.levels)) if (v > 0) ug[id] = v * err;
    return stress(ug, c, solutes, spec.stress);
  }
  const truth = truthFor(c, seed);
  const err = 1 + PREP_RSD * makeRng(`${c.id}|${seed}|prep|${spec.prep}|${spec.mg}|${spec.ml}|${spec.dilution}`).gauss();
  // mg/g x mg sample / mL = µg/mL in the extract.
  let ug: Record<string, number> = {};
  for (const [id, mgPerG] of Object.entries(truth.mgPerG)) ug[id] = (mgPerG * spec.mg) / spec.ml;
  // The product's own history comes first, then anything the student did to it.
  ug = stress(ug, c, solutes, truth.variant.stress);
  // Spike added before extraction shares the sample's recovery.
  for (const [id, v] of Object.entries(spec.spike ?? {})) ug[id] = (ug[id] ?? 0) + v * spec.dilution;
  for (const id of Object.keys(ug)) ug[id] = (ug[id]! * truth.recovery * err) / spec.dilution;
  return stress(ug, c, solutes, spec.stress);
}

export function describeSpec(spec: SampleSpec, solutes: ReadonlyMap<string, Solute>): string {
  const stressText = (s: { agent: string; hours: number; tempC: number } | undefined): string => (s ? `, ${AGENT_TEXT[s.agent] ?? s.agent} ${s.hours} h at ${s.tempC} °C` : "");
  if (spec.kind === "blank") return "Blank (diluent)";
  if (spec.kind === "standard") {
    const parts = Object.entries(spec.levels).filter(([, v]) => v > 0).map(([id, v]) => `${solutes.get(id)?.abbr ?? id} ${v}`);
    return `Standard: ${parts.join(", ")} µg/mL (prep ${spec.prep})${stressText(spec.stress)}`;
  }
  const spike = Object.entries(spec.spike ?? {}).filter(([, v]) => v > 0).map(([id, v]) => `${solutes.get(id)?.abbr ?? id} +${v}`);
  return `Sample prep ${spec.prep}: ${spec.mg} mg in ${spec.ml} mL, diluted 1:${spec.dilution}${spike.length ? `, spiked ${spike.join(", ")} µg/mL` : ""}${stressText(spec.stress)}`;
}

export function toSample(id: string, contents: Record<string, number>, diluentPhi: number): Sample {
  return { id, label: id, diluentPhi, components: Object.entries(contents).map(([soluteId, ugPerMl]) => ({ soluteId, ugPerMl })) };
}
