// Mobile-phase physical properties. docs/MODEL.md section 5.

import type { Modifier } from "./types.ts";
import { BUFFERS, MODIFIER_UV, SOLVENT, T0_K, VISCOSITY } from "./tunables.ts";

/** Viscosity of a water-organic mixture, cP. */
export function viscosityCp(modifier: Modifier, phi: number, tempC: number): number {
  const T = tempC + T0_K;
  const w = VISCOSITY.water;
  const o = VISCOSITY[modifier];
  const f = Math.min(1, Math.max(0, phi));
  return Math.exp(f * (o.a + o.b / T) + (1 - f) * (w.a + w.b / T) + f * (1 - f) * (o.ax + o.bx / T));
}

/** Mole fraction of organic from its volume fraction (volumes taken as additive). */
export function moleFraction(modifier: Modifier, phi: number): number {
  const o = SOLVENT[modifier];
  const w = SOLVENT.water;
  const no = (phi * o.density) / o.mw;
  const nw = ((1 - phi) * w.density) / w.mw;
  return no + nw === 0 ? 0 : no / (no + nw);
}

/** Wilke-Chang association term (psi M) of the mixture, mole-fraction weighted. */
export function associationTerm(modifier: Modifier, phi: number): number {
  const x = moleFraction(modifier, phi);
  const o = SOLVENT[modifier];
  const w = SOLVENT.water;
  return x * o.psi * o.mw + (1 - x) * w.psi * w.mw;
}

/** Background absorbance of the mobile phase against water, mAU per cm. */
export function mobilePhaseAbsorbance(modifier: Modifier, phi: number, nm: number, buffer?: string): number {
  const m = MODIFIER_UV[modifier];
  const b = buffer ? BUFFERS[buffer] : undefined;
  // The buffer is in solvent A only, so its contribution falls as % B rises.
  const aqueous = b ? (1 - phi) * b.uv.a * Math.exp(-(nm - b.uv.nm0) / b.uv.w) : 0;
  return phi * m.a * Math.exp(-(nm - m.nm0) / m.w) + aqueous;
}
