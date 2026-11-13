// First-order degradation network. Amounts in any consistent unit of moles.

import type { Reaction, StressAgent } from "./types.ts";
import { R_KJ, T0_K } from "../engine/tunables.ts";

export function rateAt(r: Reaction, tempC: number): number {
  return r.kRefPerH * Math.exp((-r.eaKJ / R_KJ) * (1 / (tempC + T0_K) - 1 / (r.tRefC + T0_K)));
}

/** Evolve molar amounts for `hours` at `tempC` under one stress agent. */
export function degrade(amounts: ReadonlyMap<string, number>, reactions: readonly Reaction[], agent: StressAgent, hours: number, tempC: number): Map<string, number> {
  // Thermal reactions are applied only to a heat stress. Their rate constants were measured
  // well above room temperature, and carrying them down to storage conditions would be an
  // extrapolation the data does not support.
  const active = reactions.filter((r) => r.agent === agent).map((r) => ({ r, k: rateAt(r, tempC) }));
  const state = new Map(amounts);
  if (hours <= 0 || active.length === 0) return state;
  const kMax = Math.max(...active.map((a) => a.k));
  const steps = Math.min(20000, Math.max(50, Math.ceil(kMax * hours * 20)));
  const dt = hours / steps;
  const ids = [...new Set([...state.keys(), ...active.flatMap((a) => [a.r.from, ...(a.r.to ? [a.r.to] : []), ...(a.r.coProduct ? [a.r.coProduct] : [])])])];
  const idx = new Map(ids.map((id, i) => [id, i]));
  let y = ids.map((id) => state.get(id) ?? 0);
  const f = (v: number[]): number[] => {
    const d = v.map(() => 0);
    for (const { r, k } of active) {
      const i = idx.get(r.from)!;
      const flux = k * v[i]!;
      d[i]! -= flux;
      if (r.to) d[idx.get(r.to)!]! += flux * r.yield;
      if (r.coProduct) d[idx.get(r.coProduct)!]! += flux * r.yield;
    }
    return d;
  };
  for (let s = 0; s < steps; s++) {
    const k1 = f(y);
    const k2 = f(y.map((v, i) => v + (dt / 2) * k1[i]!));
    const k3 = f(y.map((v, i) => v + (dt / 2) * k2[i]!));
    const k4 = f(y.map((v, i) => v + dt * k3[i]!));
    y = y.map((v, i) => Math.max(0, v + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!)));
  }
  return new Map(ids.map((id, i) => [id, y[i]!]));
}
