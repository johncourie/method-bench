// Retention factor as a function of composition, temperature and pH.
// Equations and sources: docs/MODEL.md sections 1 to 3.

import type { Ionization, RetentionParams } from "./types.ts";
import { R_KJ, T0_K } from "./tunables.ts";

/** Neue-Kuss ln k at the reference temperature (reduces to LSS when S2 = 0). */
export function lnKRef(p: RetentionParams, phi: number): number {
  const d = 1 + p.S2 * phi;
  return p.lnkw + 2 * Math.log(d) - (p.S1 * phi) / d;
}

/** van 't Hoff shift of ln k from the reference temperature to tempC. */
export function lnKTempShift(p: RetentionParams, phi: number, tempC: number): number {
  const dH = p.dH0 + p.dH1 * phi;
  return (-dH / R_KJ) * (1 / (tempC + T0_K) - 1 / (p.tRefC + T0_K));
}

/**
 * Factor applied to the neutral-form k for a monoprotic acid or base:
 * k = k_neutral * (1 + r * 10^x) / (1 + 10^x), where x = pH - pKa' for an acid and
 * pKa' - pH for a base, r = k_ionized / k_neutral, and pKa' is the apparent pKa
 * in the mixed solvent.
 */
export function ionizationFactor(ion: Ionization | undefined, pH: number, phi: number): number {
  if (!ion) return 1;
  const pKaApp = ion.pKa + ion.dpKaDphi * phi;
  const x = ion.kind === "acid" ? pH - pKaApp : pKaApp - pH;
  const ratio = Math.pow(10, x);
  return (1 + ion.ionizedRatio * ratio) / (1 + ratio);
}

export interface KContext {
  p: RetentionParams;
  ion: Ionization | undefined;
  tempC: number;
  pH: number;
}

/** Retention factor k at composition phi. */
export function retentionFactor(c: KContext, phi: number): number {
  const f = Math.min(1, Math.max(0, phi));
  const lnk = lnKRef(c.p, f) + lnKTempShift(c.p, f, c.tempC);
  return Math.exp(lnk) * ionizationFactor(c.ion, c.pH, f);
}

/** d(ln k)/d(phi), by central difference. Used for band compression. */
export function dLnKdPhi(c: KContext, phi: number): number {
  const h = 1e-4;
  const a = Math.max(0, phi - h);
  const b = Math.min(1, phi + h);
  return (Math.log(retentionFactor(c, b)) - Math.log(retentionFactor(c, a))) / (b - a);
}
