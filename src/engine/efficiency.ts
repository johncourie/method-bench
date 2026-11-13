// Column hydrodynamics: dead time, plate height, pressure. docs/MODEL.md section 6.

import type { Column, Modifier } from "./types.ts";
import { associationTerm, viscosityCp } from "./mobilephase.ts";
import { KOZENY, MOLAR_VOLUME_PER_MW, SYSTEM_BAR_PER_FLOW_CP, T0_K, WILKE_CHANG } from "./tunables.ts";

/** Empty-tube cross-section, cm^2. */
function areaCm2(col: Column): number {
  const r = col.idMm / 20;
  return Math.PI * r * r;
}

/** Column dead volume, mL. */
export function deadVolumeMl(col: Column): number {
  return col.porosityTotal * areaCm2(col) * (col.lengthMm / 10);
}

/** Column dead time, min. */
export function deadTimeMin(col: Column, flowMlMin: number): number {
  return deadVolumeMl(col) / flowMlMin;
}

/** Diffusion coefficient of a solute in the mobile phase, cm^2/s (Wilke-Chang). */
export function diffusionCm2S(mw: number, modifier: Modifier, phi: number, tempC: number): number {
  const eta = viscosityCp(modifier, phi, tempC);
  const V = MOLAR_VOLUME_PER_MW * mw;
  return (WILKE_CHANG * Math.sqrt(associationTerm(modifier, phi)) * (tempC + T0_K)) / (eta * Math.pow(V, 0.6));
}

/** Interstitial linear velocity, cm/s. */
export function interstitialVelocity(col: Column, flowMlMin: number): number {
  return flowMlMin / 60 / (col.porosityExt * areaCm2(col));
}

/** Reduced velocity nu = u_e d_p / D_m. */
export function reducedVelocity(col: Column, flowMlMin: number, dm: number): number {
  return (interstitialVelocity(col, flowMlMin) * col.particleUm * 1e-4) / dm;
}

/** Plate height over column length, 1/N, from the reduced van Deemter equation. */
export function plateFraction(col: Column, flowMlMin: number, dm: number): number {
  const nu = reducedVelocity(col, flowMlMin, dm);
  const h = col.vd.A + col.vd.B / nu + col.vd.C * nu;
  return (h * col.particleUm * 1e-3) / col.lengthMm;
}

/** Column pressure drop, bar (Kozeny-Carman), plus a small system contribution. */
export function pressureBar(col: Column, flowMlMin: number, modifier: Modifier, phi: number, tempC: number): number {
  const eta = viscosityCp(modifier, phi, tempC) * 1e-3; // Pa s
  const uS = (flowMlMin * 1e-6) / 60 / (areaCm2(col) * 1e-4); // m/s
  const e = col.porosityExt;
  const dp = col.particleUm * 1e-6;
  const pa = (KOZENY * eta * uS * (col.lengthMm * 1e-3) * (1 - e) * (1 - e)) / (e * e * e * dp * dp);
  return pa / 1e5 + SYSTEM_BAR_PER_FLOW_CP * flowMlMin * eta * 1e3;
}
