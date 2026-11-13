// Every physical constant and model coefficient used by the engine, with its
// source. docs/MODEL.md repeats these with the full citations.

/** Gas constant, kJ mol^-1 K^-1. */
export const R_KJ = 8.314462618e-3;
/** 0 degC in kelvin. */
export const T0_K = 273.15;

/**
 * Viscosity of water-organic mixtures, mPa s (cP):
 *   ln eta = phi (a_o + b_o / T) + (1 - phi) (a_w + b_w / T) + phi (1 - phi) (a_x + b_x / T)
 * T in kelvin, phi the organic volume fraction. The coefficients were chosen for this
 * project to reproduce the pure-solvent viscosities at 25 and 60 degC and the well-known
 * mixture maxima at 25 degC (about 1.0 cP near 20% acetonitrile, about 1.6 cP near 45%
 * methanol). They are an approximation, not a fit to a tabulated data set, and they
 * affect only pressure and diffusion. See docs/MODEL.md section 5.
 */
export const VISCOSITY = {
  water: { a: -6.254, b: 1830 },
  MeCN: { a: -3.585, b: 748, ax: -1.32, bx: 930 },
  MeOH: { a: -4.808, b: 1252, ax: -2.54, bx: 1700 },
} as const;

/** Wilke-Chang association factors and solvent properties (Wilke and Chang, AIChE J. 1955, 1, 264). */
export const SOLVENT = {
  water: { psi: 2.6, mw: 18.015, density: 0.997 },
  MeCN: { psi: 1.0, mw: 41.053, density: 0.786 },
  MeOH: { psi: 1.9, mw: 32.042, density: 0.791 },
} as const;

/** Wilke-Chang prefactor for D in cm^2/s with eta in cP, V in cm^3/mol, T in K. */
export const WILKE_CHANG = 7.4e-8;

/**
 * Solute molar volume at the normal boiling point is estimated as this many
 * cm^3/mol per g/mol of molecular weight when no structure-based value is given.
 * An approximation; it enters diffusion only as V^-0.6.
 */
export const MOLAR_VOLUME_PER_MW = 0.95;

/** Kozeny-Carman constant for a packed bed of spheres. */
export const KOZENY = 180;

/** Pressure contributed by tubing, injector and detector, bar per (mL/min) per cP. */
export const SYSTEM_BAR_PER_FLOW_CP = 8;

/** Mass of analyte that saturates a 150 x 4.6 mm column, mg. Scales with bed volume. Approximate. */
export const SATURATION_MG_150x46 = 60;

/** UV absorbance of the organic modifier against water, as a * exp(-(nm - nm0) / w), mAU in a 1 cm cell. */
export const MODIFIER_UV = {
  MeCN: { a: 60, nm0: 195, w: 6 },
  MeOH: { a: 1000, nm0: 205, w: 7 },
} as const;

/** Electrospray: counts x min per pmol on column at unit relative response. */
export const MS_COUNTS_PER_PMOL = 2.0e5;
/** Electrospray background, counts per second. */
export const MS_BACKGROUND = 400;
/** Half-width of a single-quadrupole mass window, Da. */
export const MS_WINDOW_DA = 0.5;

/** Re-equilibration between gradient runs, in column volumes. */
export const REEQUILIBRATION_CV = 10;

/** Autosampler precision: relative standard deviation of the injected volume. Typical specification, assumed. */
export const INJECTION_RSD = 0.003;
/** Run-to-run relative standard deviation of the delivered flow. Typical, assumed. */
export const FLOW_RSD = 0.0007;
/** Run-to-run standard deviation of the column temperature, degC. Typical, assumed. */
export const OVEN_SD_C = 0.1;

/** Electrospray response: run-to-run relative standard deviation of the source. Typical, assumed. */
export const MS_SOURCE_RSD = 0.04;
/** Count rate at which the mass detector's response has fallen to half of proportional, counts per second. Assumed. */
export const MS_SATURATION_CPS = 2e7;
/** Slow UV baseline noise: standard deviation as a multiple of the instrument's 1 Hz white-noise figure. Assumed. */
export const UV_FLICKER_RATIO = 2.5;
/** Memory of the slow UV baseline noise, min (about 4 s). Assumed. */
export const UV_FLICKER_TAU_MIN = 0.07;
/** Size of the unretained solvent disturbance at 200 nm, mAU min per uL injected per unit composition mismatch. Assumed. */
export const SOLVENT_FRONT_MAU_MIN_PER_UL = 0.06;
