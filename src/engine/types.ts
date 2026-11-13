// Shared engine types. Units are fixed across the engine:
//   time: min   volume: mL (injection in uL)   length: mm   particle: um
//   temperature: degC at the API, K inside thermodynamic terms
//   phi: organic volume fraction 0..1   pressure: bar   absorbance: mAU

export type Modifier = "MeCN" | "MeOH";

/** How a number got into the data set. Shown to the student in the debrief. */
export type Basis = "reported" | "digitized" | "fitted" | "assumed";

export interface Provenance {
  basis: Basis;
  /** Key into references.json. */
  ref: string;
  /** Table, figure or section in the source. */
  locus?: string;
  note?: string;
}

/**
 * Neue-Kuss retention: ln k = lnkw + 2 ln(1 + S2 phi) - S1 phi / (1 + S2 phi).
 * S2 = 0 reduces it to the linear-solvent-strength model ln k = lnkw - S1 phi.
 */
export interface RetentionParams {
  lnkw: number;
  S1: number;
  S2: number;
  /** Organic fraction range the fit is supported by. Outside it the run is flagged as extrapolated. */
  phiRange: [number, number];
  /** Temperature the parameters refer to, degC. */
  tRefC: number;
  /** Enthalpy of transfer, kJ/mol: dH(phi) = dH0 + dH1 * phi. Negative means retention falls on heating. */
  dH0: number;
  dH1: number;
  /** Ionization on this column, when it differs from the solute's general record (the apparent pKa depends on the phase and the composition it was measured at). */
  ionization?: Ionization;
  prov: Provenance;
}

export interface Ionization {
  kind: "acid" | "base";
  /** Aqueous pKa. */
  pKa: number;
  /** Shift of apparent pKa per unit organic fraction (acids rise, bases fall). */
  dpKaDphi: number;
  /** k(ionized) / k(neutral). */
  ionizedRatio: number;
  prov: Provenance;
}

export interface UvBand {
  /** Band centre, nm. */
  nm: number;
  /** Molar absorptivity at the centre, L mol^-1 cm^-1. */
  eps: number;
  /** Gaussian standard deviation of the band, nm. */
  width: number;
}

export interface Solute {
  id: string;
  name: string;
  abbr: string;
  /** Average molecular weight, g/mol. */
  mw: number;
  /** Monoisotopic mass, Da. */
  monoMass: number;
  /** Retention per column id, per modifier. */
  retention: Record<string, Partial<Record<Modifier, RetentionParams>>>;
  ionization?: Ionization;
  uv: UvBand[];
  uvProv: Provenance;
  /** Relative electrospray response (1 = reference), per polarity. */
  msResponse: { pos: number; neg: number };
  /** Exponential tail time constant as a fraction of sigma on a well-behaved column. */
  tailRatio: number;
  /** Matrix species only: fraction of electrospray response a co-eluting analyte loses at high load. */
  ionSuppression?: number;
  /** Hidden from the student's compound list (matrix and unknown degradants). */
  hidden?: boolean;
}

export type ParticleType = "FPP" | "SPP";

export interface Column {
  id: string;
  name: string;
  chemistry: string;
  lengthMm: number;
  idMm: number;
  particleUm: number;
  particleType: ParticleType;
  /** Total porosity (dead volume / empty-tube volume). */
  porosityTotal: number;
  /** Interstitial porosity. */
  porosityExt: number;
  /** Reduced van Deemter coefficients h = A + B/nu + C nu. */
  vd: { A: number; B: number; C: number };
  pHRange: [number, number];
  tMaxC: number;
  pMaxBar: number;
  prov: Provenance;
}

export interface Instrument {
  id: string;
  name: string;
  /** Gradient delay (dwell) volume, mL. */
  dwellMl: number;
  /** Extra-column volume variance, uL^2. */
  extraColVarUl2: number;
  /** Detector time constant, s. */
  detTauS: number;
  /** Pump pressure limit, bar. */
  pMaxBar: number;
  /** UV flow-cell path length, cm. */
  pathCm: number;
  /** UV detector short-term noise, mAU (standard deviation at 1 Hz bandwidth). */
  uvNoiseMau: number;
  /** Stray light fraction that bends the Beer-Lambert response at high absorbance. */
  strayLight: number;
}

export interface GradientPoint {
  /** Time, min, measured at the pump. */
  t: number;
  /** Organic fraction 0..1. */
  phi: number;
}

export type Detector =
  | { kind: "uv"; nm: number; rateHz: number }
  | { kind: "ms"; mz: number; polarity: "pos" | "neg"; rateHz: number };

export interface Method {
  columnId: string;
  modifier: Modifier;
  /** pH of the aqueous component before mixing. */
  pH: number;
  tempC: number;
  flowMlMin: number;
  /** Piecewise-linear programme; a single point or equal phis means isocratic. */
  program: GradientPoint[];
  runTimeMin: number;
  injUl: number;
  detector: Detector;
}

export interface SampleComponent {
  soluteId: string;
  /** Concentration in the vial, ug/mL. */
  ugPerMl: number;
}

export interface Sample {
  id: string;
  label: string;
  components: SampleComponent[];
  /** Organic fraction of the sample diluent. */
  diluentPhi: number;
}

/** What the engine knows about a peak. Never shown to the student before the debrief. */
export interface TruePeak {
  soluteId: string;
  tR: number;
  sigma: number;
  tau: number;
  /** Peak area in detector units x min. */
  area: number;
  kElution: number;
  eluted: boolean;
  extrapolated: boolean;
}

export interface RunResult {
  time: Float64Array;
  signal: Float64Array;
  /** Detector unit label. */
  unit: "mAU" | "counts";
  peaks: TruePeak[];
  t0: number;
  tDwell: number;
  pressureBarMax: number;
  warnings: string[];
}
