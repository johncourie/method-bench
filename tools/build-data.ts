// Assembles src/data/*.json from the fits and the transcribed tables.
// Run: node tools/fit-catechins.ts && node tools/build-data.ts
// Every number written here carries a provenance record; see docs/DATA.md.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { programTime } from "../src/engine/gradient.ts";
import { integrate } from "../src/engine/integrate.ts";
import { computeBands, simulateRun } from "../src/engine/simulate.ts";
import type { Column, Instrument, Ionization, Method, Provenance, RetentionParams, Solute, UvBand } from "../src/engine/types.ts";
import type { CaseDef, Reaction } from "../src/lab/types.ts";
import { CB_COLUMNS, CBD_AREA_BY_NM, K70, SLOPE, SLOPE_220 } from "./cannabinoid-data.ts";
import { deadTime, METHODS, POROSITY, type PublishedMethod } from "./catechin-methods.ts";
import { levenbergMarquardt } from "./lm.ts";

const out = (name: string, data: unknown): void => writeFileSync(new URL(`../src/data/${name}.json`, import.meta.url), `${JSON.stringify(data, null, 1)}\n`);
const fit = JSON.parse(readFileSync(new URL("./out/catechins-fit.json", import.meta.url), "utf8")) as {
  tRef: number;
  dH: number;
  global: { compounds: string[]; lnkw: Record<string, number>; S: Record<string, number>; delta: Record<string, number>; rms: number };
  epsilon: Record<string, Record<string, number>>;
  loo: Array<{ id: string; rmsPct: number; maxPct: number; rows: Array<{ c: string; obs: number; pred: number }>; orderMatches: number; pairs: number }>;
  pfpFit: Record<string, { lnkw: number; S: number }>;
};
const digitizedPath = new URL("./out/cannabinoid-ph.json", import.meta.url);
const phFit = existsSync(digitizedPath)
  ? (JSON.parse(readFileSync(digitizedPath, "utf8")) as {
      anionRatio: number;
      phTable: number;
      ph: Record<string, Record<string, { pKa: number; phi: number; rms: number }>>;
      slopes: Record<string, Record<string, { digitized: number; printed: number; n: number }>>;
    })
  : null;

const round = (x: number, n = 4): number => Number(x.toFixed(n));

// ---------------------------------------------------------------- references
const references = {
  heliyon2024: { citation: "Jakabova S, Arvay J, Snirc M, Lakatosova J, Ondejcikova A, Golian J. HPLC-DAD method for simultaneous determination of gallic acid, catechins, and methylxanthines. Heliyon 2024, 10, e35819.", doi: "10.1016/j.heliyon.2024.e35819", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11365376/", license: "CC BY-NC-ND 4.0. Only method conditions and retention times (facts) are used." },
  "molecules2021-3485": { citation: "Cabrera M, Taher F, Llantada A, Do Q, Sapp T, Sommerhalter M. Effect of Water Hardness on Catechin and Caffeine Content in Green Tea Infusions. Molecules 2021, 26, 3485.", doi: "10.3390/molecules26123485", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8229914/", license: "CC BY 4.0" },
  pedan2018: { citation: "Pedan V, Rohn S, Holinger M, Huhn T, Chetschik I. Bioactive Compound Fingerprint Analysis of Aged Raw Pu'er Tea and Young Ripened Pu'er Tea. Molecules 2018, 23, 1931.", doi: "10.3390/molecules23081931", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6222816/", license: "CC BY 4.0" },
  xiao2021: { citation: "Xiao S, Huang J, Huang Y, et al. Flavor Characteristics of Ganpu Tea Formed During the Sun-Drying Processing and Its Antidepressant-Like Effects. Front Nutr 2021, 8, 647537.", doi: "10.3389/fnut.2021.647537", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8044837/", license: "CC BY" },
  jin2019: { citation: "Jin Y, Zhao J, Kim EM, et al. Comprehensive Investigation of the Effects of Brewing Conditions in Sample Preparation of Green Tea Infusions. Molecules 2019, 24, 1735.", doi: "10.3390/molecules24091735", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6539062/", license: "CC BY 4.0" },
  chen2018: { citation: "Chen S, Li M, Zheng G, et al. Metabolite Profiling of 14 Wuyi Rock Tea Cultivars Using UPLC-QTOF MS and UPLC-QqQ MS Combined with Chemometrics. Molecules 2018, 23, 104.", doi: "10.3390/molecules23020104", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6017971/", license: "CC BY 4.0" },
  foods2026: { citation: "Paliu I-A, Gherghina F-L, Bita A, et al. Methylxanthine Content in Green Tea Supplements: UHPLC Quantification, Method Validation, and Implications for Ergogenic Dosing in Athletes. Foods 2026, 15, 2504.", doi: "10.3390/foods15142504", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC13409502/", license: "CC BY" },
  kaeswurm2021: { citation: "Kaeswurm JAH, Scharinger A, Teipel J, Buchweitz M. Absorption Coefficients of Phenolic Structures in Different Solvents Routinely Used for Experiments. Molecules 2021, 26, 4656.", doi: "10.3390/molecules26154656", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8348453/", license: "CC BY 4.0" },
  law2017: { citation: "Law FCP, Yao M, Bi H-C, Lam S. Physiologically based pharmacokinetic modeling of tea catechin mixture in rats and humans. Pharmacol Res Perspect 2017, 5, e00305.", doi: "10.1002/prp2.305", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5464336/", license: "CC BY" },
  wang2006: { citation: "Wang R, Zhou W, Wen RH. Kinetic study of the thermal stability of tea catechins in aqueous systems using a microwave reactor. J Agric Food Chem 2006, 54, 5924. Activation energies from the abstract.", doi: "10.1021/jf0611419", url: "https://doi.org/10.1021/jf0611419", license: "Not open access. Three activation energies from the abstract are cited as facts." },
  owolabi2025: { citation: "Owolabi A, Ogunsola O, Joens E, Kotler M, Song L. A Systematic Study of Liquid Chromatography in Search of the Best Separation of Cannabinoids for Potency Testing of Hemp-Based Products. Molecules 2025, 30, 758.", doi: "10.3390/molecules30040758", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11858520/", license: "CC BY 4.0" },
  scirep2022: { citation: "Analakkattillam S, Langsi VK, Hanrahan JP, Moore E. Analytical method validation for assay determination of cannabidiol and tetrahydrocannabinol in hemp oil infused products by RP-HPLC. Sci Rep 2022, 12, 12453.", doi: "10.1038/s41598-022-13737-6", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9304360/", license: "CC BY 4.0" },
  abc2024: { citation: "Brighenti V, Marani M, Caroli C, et al. A new HPLC method with multiple detection systems for impurity analysis and discrimination of natural versus synthetic cannabidiol. Anal Bioanal Chem 2024, 416, 4555.", doi: "10.1007/s00216-024-05396-5", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11294429/", license: "CC BY 4.0" },
  molecules2019: { citation: "Mandrioli M, Tura M, Scotti S, Gallina Toschi T. Fast Detection of 10 Cannabinoids by RP-HPLC-UV Method in Cannabis sativa L. Molecules 2019, 24, 2113.", doi: "10.3390/molecules24112113", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6600594/", license: "CC BY 4.0" },
  wang2016: { citation: "Wang M, Wang Y-H, Avula B, et al. Decarboxylation Study of Acidic Cannabinoids: A Novel Approach Using Ultra-High-Performance Supercritical Fluid Chromatography/Photodiode Array-Mass Spectrometry. Cannabis Cannabinoid Res 2016, 1, 262.", doi: "10.1089/can.2016.0020", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5549281/", license: "CC BY 4.0" },
  golombek2020: { citation: "Golombek P, Muller M, Barthlott I, Sproll C, Lachenmeier DW. Conversion of Cannabidiol (CBD) into Psychotropic Cannabinoids Including Tetrahydrocannabinol (THC): A Controversy in the Scientific Literature. Toxics 2020, 8, 41.", doi: "10.3390/toxics8020041", url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7357058/", license: "CC BY 4.0" },
  hazekamp2005: { citation: "Hazekamp A, Peltenburg A, Verpoorte R, Giroud C. Chromatographic and spectroscopic data of cannabinoids from Cannabis sativa L. J Liq Chromatogr Relat Technol 2005, 28, 2361; reproduced as Chapter 6 of Hazekamp A, doctoral thesis, Leiden University, 2007.", url: "https://hdl.handle.net/1887/12297", license: "Not Creative Commons. Band positions and one molar absorptivity are cited as published physical constants; no table or figure is reproduced." },
  pubchem: { citation: "PubChem Compound, National Center for Biotechnology Information. Formula and molecular weight by CID; monoisotopic masses calculated from the formula.", url: "https://pubchem.ncbi.nlm.nih.gov/", license: "Public domain (US government work)" },
  "this-work": { citation: "Fitted or assumed for this project. See docs/DATA.md for the method and the reasons.", url: "https://github.com/johncourie/method-bench", license: "CC BY 4.0" },
};

// ---------------------------------------------------------------- instruments
const instruments: Instrument[] = [
  { id: "hplc", name: "HPLC, 600 bar, quaternary pump", dwellMl: 1.0, extraColVarUl2: 25, detTauS: 0.3, pMaxBar: 600, pathCm: 1, uvNoiseMau: 0.008, strayLight: 0.0005 },
  { id: "uhplc", name: "UHPLC, 1200 bar, binary pump", dwellMl: 0.15, extraColVarUl2: 6, detTauS: 0.1, pMaxBar: 1200, pathCm: 1, uvNoiseMau: 0.008, strayLight: 0.0005 },
];

// ---------------------------------------------------------------- columns
const VD = { FPP: { A: 1.0, B: 2.5, C: 0.08 }, SPP: { A: 0.5, B: 2.0, C: 0.05 } } as const;
const columnOf = (id: string, name: string, chemistry: string, L: number, d: number, dp: number, type: "FPP" | "SPP", ref: string, note: string): Column => ({
  id,
  name,
  chemistry,
  lengthMm: L,
  idMm: d,
  particleUm: dp,
  particleType: type,
  porosityTotal: POROSITY[type],
  porosityExt: 0.4,
  vd: { ...VD[type] },
  pHRange: [2, 8],
  tMaxC: 60,
  pMaxBar: dp < 2 ? 1200 : dp < 4 ? 600 : 400,
  prov: { basis: "assumed", ref, note: `Dimensions as in the source. Porosity and plate-height coefficients are typical values for the particle class. ${note}` },
});

const CATECHIN_COLUMN: Record<string, { id: string; name: string; chem: string }> = {
  heliyon2024: { id: "lit-heliyon-c18", name: "C18, fully porous 5 µm (literature check only)", chem: "C18, end-capped" },
  "molecules3485-c18": { id: "gt-c18-spp4", name: "C18, superficially porous 4 µm", chem: "C18, end-capped" },
  pedan2018: { id: "gt-c18-fpp35", name: "C18, fully porous 3.5 µm", chem: "C18, extra dense bonding" },
  xiao2021: { id: "gt-c18-fpp17", name: "C18, hybrid 1.7 µm", chem: "C18 on hybrid silica" },
  jin2019: { id: "lit-jin-c18", name: "C18, 1.8 µm (literature check only)", chem: "C18" },
  chen2018: { id: "lit-chen-c18", name: "C18 T3, 1.8 µm (literature check only)", chem: "C18, low ligand density" },
  foods2026: { id: "lit-foods-c18", name: "C18, superficially porous 2.7 µm (literature check only)", chem: "C18" },
  "molecules3485-pfp-long": { id: "gt-pfp-spp4", name: "PFP, superficially porous 4 µm", chem: "Pentafluorophenyl" },
  "molecules3485-pfp-short": { id: "gt-pfp-spp19", name: "PFP, superficially porous 1.9 µm", chem: "Pentafluorophenyl" },
};
const methodById = new Map(METHODS.map((m) => [m.id, m]));
const columns: Column[] = [];
for (const [mid, c] of Object.entries(CATECHIN_COLUMN)) {
  const m = methodById.get(mid)!;
  columns.push(columnOf(c.id, c.name, c.chem, m.lengthMm, m.idMm, m.particleUm, m.particleType, m.ref, `Source column: ${m.sourceColumn}.`));
}
const CB_META: Record<string, { name: string; chem: string; source: string }> = {
  "cb-c18": { name: "C18, superficially porous 2.7 µm", chem: "Dimethyl-octadecyl", source: "Poroshell 120 EC-C18" },
  "cb-c18sp": { name: "C18 sterically protected, superficially porous 2.7 µm", chem: "Diisobutyl-octadecyl", source: "Raptor ARC-18" },
  "cb-carb": { name: "C18 with embedded carbamate, superficially porous 2.7 µm", chem: "Embedded polar group (carbamate)", source: "Cortecs Shield RP-18" },
  "cb-amide": { name: "RP-amide, superficially porous 2.7 µm", chem: "Embedded polar group (amide)", source: "Ascentis Express RP-Amide" },
};
for (const id of CB_COLUMNS) columns.push(columnOf(id, CB_META[id]!.name, CB_META[id]!.chem, 150, 2.1, 2.7, "SPP", "owolabi2025", `Source column: ${CB_META[id]!.source}.`));
columns.push(columnOf("cb-c18sp-x2", "C18 sterically protected, two columns in series", "Diisobutyl-octadecyl", 300, 2.1, 2.7, "SPP", "owolabi2025", "Source: two Raptor ARC-18 columns in series."));
columns.push(columnOf("lit-abc-c18", "C18, superficially porous 2.7 µm (literature check only)", "C18", 150, 3.0, 2.7, "SPP", "abc2024", "Source column: Ascentis Express C18."));

// ---------------------------------------------------------------- solutes: shared pieces
const assumed = (note: string): Provenance => ({ basis: "assumed", ref: "this-work", note });
const band = (nm: number, eps: number, width: number): UvBand => ({ nm, eps: Math.round(eps), width });
const epsAt = (bands: UvBand[], nm: number): number => bands.reduce((s, b) => s + b.eps * Math.exp(-0.5 * ((nm - b.nm) / b.width) ** 2), 0);

const solutes: Solute[] = [];

// ---------------------------------------------------------------- catechins
const GT: Record<string, { name: string; abbr: string; mw: number; mono: number }> = {
  ga: { name: "Gallic acid", abbr: "GA", mw: 170.12, mono: 170.02152 },
  gc: { name: "(-)-Gallocatechin", abbr: "GC", mw: 306.27, mono: 306.07395 },
  egc: { name: "(-)-Epigallocatechin", abbr: "EGC", mw: 306.27, mono: 306.07395 },
  c: { name: "(+)-Catechin", abbr: "C", mw: 290.27, mono: 290.07904 },
  ec: { name: "(-)-Epicatechin", abbr: "EC", mw: 290.27, mono: 290.07904 },
  egcg: { name: "(-)-Epigallocatechin gallate", abbr: "EGCG", mw: 458.4, mono: 458.08491 },
  gcg: { name: "(-)-Gallocatechin gallate", abbr: "GCG", mw: 458.4, mono: 458.08491 },
  ecg: { name: "(-)-Epicatechin gallate", abbr: "ECG", mw: 442.4, mono: 442.09 },
  cg: { name: "(-)-Catechin gallate", abbr: "CG", mw: 442.4, mono: 442.09 },
  caf: { name: "Caffeine", abbr: "Caffeine", mw: 194.19, mono: 194.08038 },
  tbm: { name: "Theobromine", abbr: "Theobromine", mw: 180.16, mono: 180.06473 },
  tep: { name: "Theophylline", abbr: "Theophylline", mw: 180.16, mono: 180.06473 },
};

// Molar absorptivity near 280 nm. Four values are reported (Kaeswurm 2021, methanol/water);
// the rest are scaled from calibration slopes at 280 nm in Cabrera 2021 Table S1, relative to catechin.
const SLOPE_280: Record<string, number> = { gc: 4852, egc: 9600, caf: 59231, c: 17606, ec: 15871, egcg: 30122, gcg: 35812, ecg: 43028, cg: 45621 };
const EPS_REPORTED: Record<string, { nm: number; eps: number }> = { ga: { nm: 273, eps: 9507 }, c: { nm: 280, eps: 4175 }, ec: { nm: 280, eps: 3981 }, egcg: { nm: 277, eps: 10735 } };
const BAND_CENTRE: Record<string, number> = { ga: 273, gc: 271, egc: 271, c: 280, ec: 280, egcg: 277, gcg: 277, ecg: 278, cg: 278, caf: 273, tbm: 273, tep: 271 };
const BAND_W = 14;
function catechinUv(id: string): { uv: UvBand[]; prov: Provenance } {
  const centre = BAND_CENTRE[id]!;
  const rep = EPS_REPORTED[id];
  let eps: number;
  let prov: Provenance;
  if (rep) {
    eps = rep.eps;
    prov = { basis: "reported", ref: "kaeswurm2021", locus: "Table 1, methanol/water 50:50", note: "Band maximum and molar absorptivity reported. Band width and the short-wavelength band are assumed." };
  } else if (SLOPE_280[id]) {
    const eps280 = 4175 * (SLOPE_280[id]! / SLOPE_280.c!) * (GT[id]!.mw / GT.c!.mw);
    eps = eps280 / Math.exp(-0.5 * ((280 - centre) / BAND_W) ** 2);
    prov = { basis: "fitted", ref: "molecules2021-3485", locus: "Supplementary Table S1 slopes at 280 nm", note: "Scaled from the calibration slope relative to catechin, whose molar absorptivity is reported (Kaeswurm 2021). Band position and width are assumed." };
  } else {
    eps = 10000;
    prov = assumed("Typical value for a methylxanthine. No open source was found.");
  }
  return { uv: [band(centre, eps, BAND_W), band(205, 6 * eps, 9)], prov };
}

const gtColumnIds = Object.values(CATECHIN_COLUMN).map((c) => c.id);
const pfpIds = ["gt-pfp-spp4", "gt-pfp-spp19"];
const pfpCommon = Object.keys(fit.pfpFit);
const pfpShift = {
  lnkw: pfpCommon.reduce((s, c) => s + fit.pfpFit[c]!.lnkw - fit.global.lnkw[c]!, 0) / pfpCommon.length,
  S: pfpCommon.reduce((s, c) => s + fit.pfpFit[c]!.S - fit.global.S[c]!, 0) / pfpCommon.length,
};
const GT_PHI: [number, number] = [0.01, 0.45];

function catechinRetention(id: string): Solute["retention"] {
  const r: Solute["retention"] = {};
  for (const [mid, col] of Object.entries(CATECHIN_COLUMN)) {
    const m = methodById.get(mid)!;
    let p: RetentionParams;
    if (m.phase === "PFP") {
      const f = fit.pfpFit[id];
      p = f
        ? { lnkw: round(f.lnkw), S1: round(f.S), S2: 0, phiRange: GT_PHI, tRefC: fit.tRef, dH0: fit.dH, dH1: 0, prov: { basis: "fitted", ref: "molecules2021-3485", locus: "Table 1 and Supplementary Table S2", note: "ln kw and S solved from two published gradients on this phase. Temperature dependence is assumed." } }
        : { lnkw: round(fit.global.lnkw[id]! + pfpShift.lnkw), S1: round(fit.global.S[id]! + pfpShift.S), S2: 0, phiRange: GT_PHI, tRefC: fit.tRef, dH0: fit.dH, dH1: 0, prov: assumed("No published retention on this phase. Estimated from the C18 fit and the mean C18-to-PFP shift of the nine compounds that were measured.") };
    } else {
      const eps = fit.epsilon[mid]?.[id];
      const base = fit.global.lnkw[id]! + fit.global.delta[mid]!;
      p = {
        lnkw: round(base + (eps ?? 0)),
        S1: round(fit.global.S[id]!),
        S2: 0,
        phiRange: GT_PHI,
        tRefC: fit.tRef,
        dH0: fit.dH,
        dH1: 0,
        prov:
          eps === undefined
            ? { basis: "fitted", ref: "this-work", note: "Not reported on this column. Predicted from the joint fit across seven published C18 methods plus this column's overall strength." }
            : { basis: "fitted", ref: m.ref, locus: m.locus, note: "S from the joint fit across seven published C18 methods; ln kw set so the source method's retention time is reproduced. Temperature dependence is assumed." },
      };
    }
    r[col.id] = { MeCN: p };
  }
  return r;
}

const phenol = (pKa: number, ref: string, basis: "reported" | "assumed", note: string): Ionization => ({ kind: "acid", pKa, dpKaDphi: 2, ionizedRatio: 0.1, prov: { basis, ref, note } });
const GT_ION: Record<string, Ionization> = {
  ga: { kind: "acid", pKa: 4.4, dpKaDphi: 2, ionizedRatio: 0.05, prov: { basis: "reported", ref: "pubchem", locus: "CID 370", note: "Aqueous pKa. Its shift with acetonitrile and the retention of the anion are assumed." } },
  egcg: phenol(7.6, "law2017", "reported", "Experimental value quoted in the source. Shift with acetonitrile and anion retention are assumed."),
  ecg: phenol(7.6, "law2017", "reported", "Experimental value quoted in the source. Shift with acetonitrile and anion retention are assumed."),
  gcg: phenol(7.6, "this-work", "assumed", "Taken equal to its epimer EGCG."),
  cg: phenol(7.6, "this-work", "assumed", "Taken equal to its epimer ECG."),
};

for (const [id, g] of Object.entries(GT)) {
  const { uv, prov } = catechinUv(id);
  const xanthine = id === "caf" || id === "tbm" || id === "tep";
  solutes.push({
    id,
    name: g.name,
    abbr: g.abbr,
    mw: g.mw,
    monoMass: g.mono,
    retention: catechinRetention(id),
    ...(GT_ION[id] ? { ionization: GT_ION[id] } : {}),
    uv,
    uvProv: prov,
    msResponse: xanthine ? { pos: 3, neg: 0 } : { pos: 0.3, neg: 1 },
    tailRatio: 0,
  });
}

// Hidden co-eluting matrix compound. On every column it is placed so that it elutes with EGCG under the
// case's starting gradient on the HPLC, and its lower S moves it away when the gradient slope changes.
const GT_START = { flow: 1, tempC: 30, program: [{ t: 0, phi: 0.05 }, { t: 30, phi: 0.4 }], dwellMl: 1.0 };
{
  const egcg = solutes.find((s) => s.id === "egcg")!;
  const retention: Solute["retention"] = {};
  for (const id of gtColumnIds) {
    const e = egcg.retention[id]!.MeCN!;
    const col = columns.find((c) => c.id === id)!;
    const t0 = (col.porosityTotal * Math.PI * (col.idMm / 20) ** 2 * (col.lengthMm / 10)) / GT_START.flow;
    const time = (lnkw: number, S: number): number => programTime((phi) => Math.exp(lnkw - S * phi), GT_START.program, t0, GT_START.dwellMl / GT_START.flow);
    const target = time(e.lnkw, e.S1);
    const S1 = round(0.8 * e.S1);
    let lo = e.lnkw - 4;
    let hi = e.lnkw + 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const t = time(mid, S1);
      if (!Number.isFinite(t) || t > target) hi = mid;
      else lo = mid;
    }
    retention[id] = { MeCN: { ...e, S1, lnkw: round((lo + hi) / 2), prov: assumed("Invented matrix compound for the co-elution exercise. It is not a real tea constituent.") } };
  }
  solutes.push({ id: "gtx", name: "Matrix compound X", abbr: "X", mw: 344.27, monoMass: 344.0743, retention, uv: [band(325, 16000, 16), band(290, 9000, 14), band(215, 30000, 9)], uvProv: assumed("Invented, with a hydroxycinnamate-like spectrum so that it differs from the catechins."), msResponse: { pos: 0.5, neg: 1 }, tailRatio: 0, ionSuppression: 0.6, hidden: true });
}

// Degradation product of the catechins under base and oxidation. Real catechin oxidation gives a family of
// dimers and quinones; one early-eluting stand-in is used so that lost material shows up in the chromatogram.
{
  const ga = solutes.find((s) => s.id === "ga")!;
  const retention: Solute["retention"] = {};
  for (const id of gtColumnIds) {
    const e = ga.retention[id]!.MeCN!;
    retention[id] = { MeCN: { ...e, lnkw: round(e.lnkw + 0.5), prov: assumed("Stand-in for catechin oxidation products. Placed a little after gallic acid.") } };
  }
  solutes.push({ id: "gtox", name: "Catechin oxidation products", abbr: "Ox", mw: 304.25, monoMass: 304.0583, retention, uv: [band(265, 9000, 18), band(380, 2500, 30), band(210, 20000, 9)], uvProv: assumed("Stand-in."), msResponse: { pos: 0.3, neg: 1 }, tailRatio: 0, hidden: true });
}

// ---------------------------------------------------------------- cannabinoids
const CB: Record<string, { name: string; abbr: string; mw: number; mono: number; acid: boolean }> = {
  cbda: { name: "Cannabidiolic acid", abbr: "CBDA", mw: 358.5, mono: 358.21441, acid: true },
  cbga: { name: "Cannabigerolic acid", abbr: "CBGA", mw: 360.5, mono: 360.23006, acid: true },
  cbg: { name: "Cannabigerol", abbr: "CBG", mw: 316.5, mono: 316.24023, acid: false },
  cbd: { name: "Cannabidiol", abbr: "CBD", mw: 314.5, mono: 314.22458, acid: false },
  thcv: { name: "Tetrahydrocannabivarin", abbr: "THCV", mw: 286.4, mono: 286.19328, acid: false },
  cbn: { name: "Cannabinol", abbr: "CBN", mw: 310.4, mono: 310.19328, acid: false },
  d9thc: { name: "delta-9-Tetrahydrocannabinol", abbr: "d9-THC", mw: 314.5, mono: 314.22458, acid: false },
  d8thc: { name: "delta-8-Tetrahydrocannabinol", abbr: "d8-THC", mw: 314.5, mono: 314.22458, acid: false },
  cbc: { name: "Cannabichromene", abbr: "CBC", mw: 314.5, mono: 314.22458, acid: false },
  thca: { name: "delta-9-Tetrahydrocannabinolic acid A", abbr: "THCA", mw: 358.5, mono: 358.21441, acid: true },
};

// Neutral-cannabinoid UV shape: three Gaussians fitted to the reported CBD response at five wavelengths.
function fitCbdShape(): UvBand[] {
  const target = CBD_AREA_BY_NM.map(([nm, a]) => [nm, a / CBD_AREA_BY_NM[0]![1]] as const);
  let best = { err: Infinity, bands: [] as UvBand[] };
  for (let w1 = 6; w1 <= 14; w1 += 0.5) {
    for (let c2 = 222; c2 <= 238; c2 += 1) {
      for (let w2 = 5; w2 <= 16; w2 += 0.5) {
        for (let r2 = 0.02; r2 <= 0.8; r2 *= 1.12) {
          const partial = [band(208, 1000, w1), band(c2, 1000 * r2, w2)];
          const at214 = epsAt(partial, 214);
          // Third band at 274 nm set from the 280 nm point.
          const need280 = target[4]![1] * at214 - epsAt(partial, 280);
          if (need280 <= 0) continue;
          const bands = [...partial, band(274, need280 / Math.exp(-0.5 * (6 / 10) ** 2), 10)];
          const ref = epsAt(bands, 214);
          let err = 0;
          for (const [nm, rel] of target.slice(1)) err += Math.log(epsAt(bands, nm) / ref / rel) ** 2;
          if (err < best.err) best = { err, bands };
        }
      }
    }
  }
  // Absolute scale: molar absorptivity of CBD at its 207 nm maximum, log eps 4.57 (Hazekamp 2005).
  const scale = Math.pow(10, 4.57) / epsAt(best.bands, 207);
  return best.bands.map((b) => band(b.nm, b.eps * scale, b.width));
}
const cbdShape = fitCbdShape();
const eps220Cbd = epsAt(cbdShape, 220);
function cannabinoidUv(id: string): { uv: UvBand[]; prov: Provenance } {
  const c = CB[id]!;
  const target = (eps220Cbd * SLOPE_220[id]! * c.mw) / (SLOPE_220.cbd! * CB.cbd!.mw);
  let shape: UvBand[];
  let note: string;
  if (id === "cbn") {
    shape = [band(217, 1000, 9), band(283, 490, 9), band(299, 340, 9)];
    note = "Band positions and relative heights as published (Hazekamp 2005). ";
  } else if (c.acid) {
    shape = [band(222, 1000, 10), band(268, 250, 12), band(305, 125, 12)];
    note = "Three bands near 222, 268 and 305 nm, as published for the acidic cannabinoids. ";
  } else {
    shape = cbdShape;
    note = "Spectral shape fitted to the reported CBD response at 214 to 280 nm (Analakkattillam 2022, Table 1b). ";
  }
  const f = target / epsAt(shape, 220);
  return {
    uv: shape.map((b) => band(b.nm, b.eps * f, b.width)),
    prov: { basis: "fitted", ref: "molecules2019", locus: "Calibration slopes at 220 nm, Section 2.2.7", note: `${note}Magnitude scaled so the response at 220 nm relative to CBD matches the published calibration slopes; the absolute scale is the published molar absorptivity of CBD at 207 nm.` },
  };
}

// Enthalpy of transfer, kJ/mol. The published robustness data (Analakkattillam 2022, Table 3: retention of CBD
// and d9-THC at 20, 25 and 30 °C on a different C18) gives -2.3 and -3.6. One value, their mean, is used for
// every cannabinoid: two numbers from another column are no basis for temperature selectivity.
const CB_DH = -3.0;
/**
 * pH of 0.02% formic acid, the A solvent of the tabulated retention factors. The paper does not report it;
 * this is the value at which the tables and the digitized pH series agree (tools/fit-cannabinoid-ph.ts).
 */
const PH_TABLE = round(phFit?.phTable ?? 3.05, 2);
const CB_PHI: [number, number] = [0.55, 0.85];

for (const [id, c] of Object.entries(CB)) {
  const retention: Solute["retention"] = {};
  CB_COLUMNS.forEach((col, i) => {
    // Printed slope, unless the plotted points clearly disagree with the legend (see docs/DATA.md).
    const dig = phFit?.slopes[col]?.[id];
    const useDigitized = dig !== undefined && dig.n >= 3 && (Math.abs(dig.digitized - dig.printed) > 0.05 || (col === "cb-amide" && !c.acid));
    const slope = useDigitized ? dig.digitized : SLOPE[id]![i]!;
    const S1 = -Math.LN10 * slope;
    let kNeutral = K70[id]![i]!;
    const ph = phFit?.ph[col]?.[id];
    let ionization: Ionization | undefined;
    if (c.acid && ph && phFit) {
      // The tabulated k is the observed k at the table's pH; convert to the neutral-form k.
      const x = Math.pow(10, PH_TABLE - ph.pKa);
      kNeutral = (kNeutral * (1 + x)) / (1 + phFit.anionRatio * x);
      ionization = {
        kind: "acid",
        pKa: round(ph.pKa, 2),
        dpKaDphi: 0,
        ionizedRatio: phFit.anionRatio,
        prov: { basis: "digitized", ref: "owolabi2025", locus: "Figure 4", note: `Apparent pKa on the aqueous pH scale at ${Math.round(ph.phi * 1000) / 10}% acetonitrile, fitted to points digitized from the figure (fit residual ${ph.rms.toFixed(3)} log units). Its change with acetonitrile content is not known and is taken as zero. Anion retention (${phFit.anionRatio} of the neutral form) is assumed.` },
      };
    }
    retention[col] = {
      MeCN: {
        lnkw: round(Math.log(kNeutral) + S1 * 0.7),
        S1: round(S1),
        S2: 0,
        phiRange: CB_PHI,
        tRefC: 30,
        dH0: CB_DH,
        dH1: 0,
        ...(ionization ? { ionization } : {}),
        prov: {
          basis: useDigitized ? "digitized" : "reported",
          ref: "owolabi2025",
          locus: c.acid ? "Table 2 and Figure 2" : "Table 1 and Figure 1",
          note: `Retention factor at 70% acetonitrile as published. Slope of log k against acetonitrile fraction ${useDigitized ? `from the points plotted in the figure (${slope.toFixed(2)}); the printed legend value (${dig!.printed.toFixed(2)}) disagrees with them` : "as printed in the figure legend"}. One enthalpy is used for all cannabinoids (mean of two values derived from Analakkattillam 2022, Table 3), so temperature changes retention but not selectivity.`,
        },
      },
    };
  });
  // Two columns in series behave as one longer column of the same phase.
  retention["cb-c18sp-x2"] = retention["cb-c18sp"]!;
  const { uv, prov } = cannabinoidUv(id);
  // Solute-level record: the mean of the per-column values, used only where a column has none.
  const perColumn = CB_COLUMNS.map((col) => retention[col]?.MeCN?.ionization).filter((v): v is Ionization => !!v);
  const ion: Ionization | undefined = c.acid
    ? {
        kind: "acid",
        pKa: perColumn.length ? round(perColumn.reduce((a, v) => a + v.pKa, 0) / perColumn.length, 2) : 3.9,
        dpKaDphi: 0,
        ionizedRatio: phFit?.anionRatio ?? 0.05,
        prov: perColumn.length ? { basis: "digitized", ref: "owolabi2025", locus: "Figure 4", note: "Apparent pKa on the aqueous pH scale, fitted per column to points digitized from the published figure (the value differs by column; the mean is shown). Anion retention is assumed." } : assumed("No pH series available."),
      }
    : undefined;
  solutes.push({ id, name: c.name, abbr: c.abbr, mw: c.mw, monoMass: c.mono, retention, ...(ion ? { ionization: ion } : {}), uv, uvProv: prov, msResponse: c.acid ? { pos: 0.3, neg: 2 } : { pos: 1, neg: 0.3 }, tailRatio: 0 });
}

// Oxidation product of CBD and THC under base, peroxide and light (a hydroxyquinone; real, but its
// retention and spectrum here are stand-ins). Elutes ahead of CBD.
{
  const cbd = solutes.find((s) => s.id === "cbd")!;
  const retention: Solute["retention"] = {};
  for (const col of [...CB_COLUMNS, "cb-c18sp-x2"]) {
    const e = cbd.retention[col]!.MeCN!;
    retention[col] = { MeCN: { ...e, lnkw: round(e.lnkw - 0.75), prov: assumed("Stand-in for cannabinoid quinone degradants. Placed ahead of CBD.") } };
  }
  solutes.push({ id: "cbq", name: "Cannabinoid quinone degradants", abbr: "Q", mw: 328.4, monoMass: 328.2038, retention, uv: [band(272, 12000, 14), band(215, 18000, 9), band(400, 800, 30)], uvProv: assumed("Stand-in."), msResponse: { pos: 0.6, neg: 1 }, tailRatio: 0, hidden: true });
}

// Unretained marker, available in both cases.
{
  const retention: Solute["retention"] = {};
  for (const c of columns) retention[c.id] = { MeCN: { lnkw: -4, S1: 0, S2: 0, phiRange: [0, 1], tRefC: 30, dH0: 0, dH1: 0, prov: assumed("Taken as unretained.") } };
  solutes.push({ id: "uracil", name: "Uracil (unretained marker)", abbr: "Uracil", mw: 112.09, monoMass: 112.02728, retention, uv: [band(259, 8200, 12), band(205, 9000, 8)], uvProv: assumed("Typical literature values."), msResponse: { pos: 0.2, neg: 0.5 }, tailRatio: 0.1 });
}

// Peak tailing differs from compound to compound. No data: a fixed spread, assigned by name so it is reproducible.
for (const s of solutes) {
  let hsh = 0;
  for (const ch of s.id) hsh = (hsh * 31 + ch.charCodeAt(0)) % 997;
  s.tailRatio = s.id === "uracil" ? 0.3 : round(0.25 + 0.4 * (hsh / 997), 2);
}

// ---------------------------------------------------------------- literature methods
const toMethod = (m: PublishedMethod, columnId: string, nm: number): Method => ({
  columnId,
  modifier: "MeCN",
  pH: m.aqueous.includes("phosphoric") ? 2.2 : 2.7,
  tempC: m.tempC,
  flowMlMin: m.flow,
  program: m.program.map(([t, phi]) => ({ t, phi: round(phi, 5) })),
  runTimeMin: Math.ceil(Math.max(...Object.values(m.rt)) * 1.25 + 2),
  injUl: 2,
  detector: { kind: "uv", nm, rateHz: 10 },
});
const literature: unknown[] = [];
for (const m of METHODS) {
  const loo = fit.loo.find((l) => l.id === m.id);
  literature.push({
    id: m.id,
    ref: m.ref,
    caseId: "greentea",
    label: m.label,
    method: toMethod(m, CATECHIN_COLUMN[m.id]!.id, m.id === "foods2026" ? 273 : 280),
    dwellMl: m.dwellMl,
    reported: Object.entries(m.rt).map(([soluteId, tR]) => ({ soluteId, tR })),
    usedInFit: true,
    ...(loo ? { heldOut: loo.rows.map((r) => ({ soluteId: r.c, tR: round(r.pred, 2) })) } : {}),
    note: `${m.locus}. Dwell volume (${m.dwellMl} mL) and porosity are assumed; the source reports neither.`,
  });
}

// Anal Bioanal Chem 2024: a gradient on a different C18. Only the column's overall strength is fitted.
const abcRt: Record<string, number> = { cbg: 11.3, cbd: 12.0, d9thc: 19.2, d8thc: 19.6, cbc: 21.8 };
{
  const col = columns.find((c) => c.id === "lit-abc-c18")!;
  const t0 = (col.porosityTotal * Math.PI * (col.idMm / 20) ** 2 * (col.lengthMm / 10)) / 0.2;
  const program = [{ t: 0, phi: 0.7 }, { t: 20, phi: 0.9 }, { t: 25, phi: 0.9 }];
  const base = (id: string) => solutes.find((s) => s.id === id)!.retention["cb-c18"]!.MeCN!;
  const pred = (id: string, d: number): number => programTime((phi) => Math.exp(base(id).lnkw + d - base(id).S1 * phi), program, t0, 0.2 / 0.2);
  const { p } = levenbergMarquardt((q) => Object.entries(abcRt).map(([id, t]) => Math.log(pred(id, q[0]!) / t)), [0], 100);
  for (const s of solutes) {
    const b = s.retention["cb-c18"]?.MeCN;
    if (b && s.id in CB) s.retention["lit-abc-c18"] = { MeCN: { ...b, lnkw: round(b.lnkw + p[0]!), prov: { basis: "fitted", ref: "abc2024", note: "C18 parameters from Owolabi 2025 shifted by one fitted column-strength term." } } };
  }
  literature.push({
    id: "abc2024",
    ref: "abc2024",
    caseId: "cannabis",
    label: "C18 superficially porous 2.7 µm, 150 x 3.0 mm, 70 to 90% MeCN in 20 min, 0.1% formic acid",
    method: { columnId: "lit-abc-c18", modifier: "MeCN", pH: 2.7, tempC: 30, flowMlMin: 0.2, program, runTimeMin: 28, injUl: 3, detector: { kind: "uv", nm: 210, rateHz: 5 } } satisfies Method,
    dwellMl: 0.2,
    reported: Object.entries(abcRt).map(([soluteId, tR]) => ({ soluteId, tR })),
    usedInFit: false,
    note: "Table 1 (UHPLC system). A different C18 column from the one the parameters were measured on: one column-strength term was fitted, selectivity and gradient behaviour are predicted. Column temperature is not reported (30 °C assumed); dwell volume assumed.",
  });
}

// ---------------------------------------------------------------- independent checks
const checks: unknown[] = [];
const hplc = instruments[0]!;
const soluteMap = new Map(solutes.map((s) => [s.id, s]));
{
  // Slope of log k against acetonitrile for CBD on an unrelated C18 (Sci Rep 2022, Table 1a at 2.0 mL/min).
  const t0 = (6.918 / (1 + 10.3)) * (1.5 / 2.0);
  const k = (tR: number): number => (tR - t0) / t0;
  const slope = (Math.log10(k(18.576)) - Math.log10(k(3.654))) / (0.6 - 0.8);
  checks.push({ caseId: "cannabis", ref: "scirep2022", quantity: "CBD: slope of log k against acetonitrile fraction, 60 to 80%", published: slope.toFixed(2), model: SLOPE.cbd![2].toFixed(2), note: "Published value computed here from Table 1a retention times and the retention factor in Table 2a, on a 5 µm C18 from another maker. Model value is the published slope on the C18 used in the simulator." });
  checks.push({ caseId: "cannabis", ref: "scirep2022", quantity: "d9-THC to CBD retention factor ratio at 75% acetonitrile", published: (21.8 / 10.3).toFixed(2), model: ((K70.d9thc![2] * Math.pow(10, SLOPE.d9thc![2] * 0.05)) / (K70.cbd![2] * Math.pow(10, SLOPE.cbd![2] * 0.05))).toFixed(2), note: "Table 2a retention factors, different C18 column and 25 °C." });
}
{
  // Plate numbers at 70% acetonitrile on the C18 column (Owolabi Supplementary Table S4), measured the way the
  // paper and the simulator's peak table measure them: 5.54 (tR / w_half)^2 on an integrated trace.
  const method: Method = { columnId: "cb-c18", modifier: "MeCN", pH: PH_TABLE, tempC: 30, flowMlMin: 0.3, program: [{ t: 0, phi: 0.7 }], runTimeMin: 20, injUl: 3, detector: { kind: "uv", nm: 230, rateHz: 20 } };
  const col = columns.find((c) => c.id === "cb-c18")!;
  const published: Record<string, number> = { cbg: 24724, cbd: 23390, thcv: 24224, cbn: 32273, d9thc: 32566, d8thc: 37029, cbc: 38570 };
  const run = simulateRun({ method, instrument: hplc, column: col, sample: { id: "s", label: "s", diluentPhi: 0.7, components: Object.keys(published).map((soluteId) => ({ soluteId, ugPerMl: 10 })) }, solutes: soluteMap, seed: "check", injRsd: 0 });
  const found = integrate(run.time, run.signal).peaks;
  const order = [...run.peaks].sort((a, b) => a.tR - b.tR).map((p) => p.soluteId);
  const ratios: number[] = [];
  order.forEach((id, i) => {
    const pk = found[i];
    if (!pk || found.length !== order.length) return;
    ratios.push(pk.plates / published[id]!);
    if (id === "cbd" || id === "cbc") checks.push({ caseId: "cannabis", ref: "owolabi2025", quantity: `Plate number of ${id.toUpperCase()}, C18 column, 70% acetonitrile, 0.3 mL/min`, published: String(published[id]), model: String(Math.round(pk.plates)), note: "Supplementary Table S4. Not an independent test: the plate-height coefficients for superficially porous columns and the instrument's extra-column volume were set with this table in view." });
  });
  console.log("plate ratio model/published:", ratios.map((r) => r.toFixed(2)).join(" "));
}
if (phFit) {
  // Resolution in the published two-column method (Owolabi Section 2.3, Figure 3B).
  const method: Method = { columnId: "cb-c18sp-x2", modifier: "MeCN", pH: 2.97, tempC: 30, flowMlMin: 0.5, program: [{ t: 0, phi: 0.75 }], runTimeMin: 20, injUl: 3, detector: { kind: "uv", nm: 230, rateHz: 10 } };
  const col = columns.find((c) => c.id === "cb-c18sp-x2")!;
  const ids = ["cbda", "cbg", "d9thc", "d8thc"];
  const bands = computeBands({ method, instrument: { ...hplc, pMaxBar: 2000 }, column: { ...col, pMaxBar: 2000 }, sample: { id: "s", label: "s", diluentPhi: 0.75, components: ids.map((soluteId) => ({ soluteId, ugPerMl: 10 })) }, solutes: soluteMap, seed: "check" });
  const rs = (a: string, b: string): string => { const x = bands.find((v) => v.soluteId === a)!; const y = bands.find((v) => v.soluteId === b)!; return (Math.abs(x.tR - y.tR) / (2 * (x.sigma + y.sigma))).toFixed(2); };
  checks.push({ caseId: "cannabis", ref: "owolabi2025", quantity: "Resolution CBDA / CBG, two sterically protected C18 columns in series, 75% acetonitrile, pH 2.97, 0.5 mL/min", published: "1.48", model: rs("cbda", "cbg"), note: "Section 2.3. Not reproduced, and not understood: the same paper's Table 1 and Figure 4 give retention factors of about 1.7 and 2.1 for this pair under these conditions, a selectivity of 1.18, which at the plate numbers the paper reports gives a resolution several times larger than 1.48. The pair named in the text may not be the adjacent pair in the published chromatogram." });
  checks.push({ caseId: "cannabis", ref: "owolabi2025", quantity: "Resolution d9-THC / d8-THC, same method", published: "1.43", model: rs("d9thc", "d8thc"), note: "Section 2.3." });
}
checks.push({ caseId: "greentea", ref: "kaeswurm2021", quantity: "Molar absorptivity of epicatechin at 280 nm, L/mol/cm", published: "3981", model: Math.round(4175 * (SLOPE_280.ec! / SLOPE_280.c!)).toString(), note: "Model value is what the slope-scaling rule gives from catechin; it is how the unreported compounds were scaled. The simulator uses the reported value for epicatechin itself." });
checks.push({ caseId: "greentea", ref: "kaeswurm2021", quantity: "Molar absorptivity of EGCG near 280 nm, L/mol/cm", published: "10735 (at 277 nm)", model: Math.round(4175 * (SLOPE_280.egcg! / SLOPE_280.c!) * (GT.egcg!.mw / GT.c!.mw)).toString(), note: "Same scaling rule, tested on a compound whose value is reported." });
for (const l of fit.loo) {
  checks.push({ caseId: "greentea", ref: methodById.get(l.id)!.ref, quantity: `Leave-one-method-out: ${methodById.get(l.id)!.label}`, published: `${l.rows.length} retention times`, model: `rms error ${l.rmsPct.toFixed(1)}%, largest single error ${l.maxPct.toFixed(1)}%, ${l.orderMatches} of ${l.pairs} pair orders correct`, note: "Model refitted without this method. One parameter, this column's overall strength, was then fitted to the held-out retention times; selectivity and gradient behaviour are predictions." });
}

// ---------------------------------------------------------------- cases
const epimer = (a: string, b: string, kf: number, kr: number, eaF: number, eaR: number, reported: boolean): Reaction[] => [
  { from: a, to: b, agent: "heat", kRefPerH: kf, tRefC: 80, eaKJ: eaF, yield: 1, ref: reported ? "wang2006" : "this-work", basis: "assumed" },
  { from: b, to: a, agent: "heat", kRefPerH: kr, tRefC: 80, eaKJ: eaR, yield: 1, ref: reported ? "wang2006" : "this-work", basis: "assumed" },
];
const lose = (from: string, agent: Reaction["agent"], k: number, ea = 50): Reaction => ({ from, to: "gtox", agent, kRefPerH: k, tRefC: 25, eaKJ: ea, yield: 1, ref: "this-work", basis: "assumed" });
const gtReactions: Reaction[] = [
  ...epimer("egcg", "gcg", 0.06, 0.05, 117.6, 84.2, true),
  ...epimer("ecg", "cg", 0.05, 0.05, 100, 100, false),
  ...epimer("egc", "gc", 0.05, 0.05, 100, 100, false),
  ...epimer("ec", "c", 0.04, 0.04, 100, 100, false),
  ...(["egcg", "gcg", "egc", "gc"] as const).map((id) => lose(id, "base", 1.8)),
  ...(["ecg", "cg"] as const).map((id) => lose(id, "base", 1.0)),
  ...(["ec", "c"] as const).map((id) => lose(id, "base", 0.3)),
  ...(["egcg", "gcg", "egc", "gc"] as const).map((id) => lose(id, "peroxide", 0.35)),
  ...(["ecg", "cg", "ec", "c"] as const).map((id) => lose(id, "peroxide", 0.1)),
  { from: "egcg", to: "egc", coProduct: "ga", agent: "acid", kRefPerH: 0.02, tRefC: 60, eaKJ: 80, yield: 1, ref: "this-work", basis: "assumed" },
  { from: "ecg", to: "ec", coProduct: "ga", agent: "acid", kRefPerH: 0.02, tRefC: 60, eaKJ: 80, yield: 1, ref: "this-work", basis: "assumed" },
  { from: "gcg", to: "gc", coProduct: "ga", agent: "acid", kRefPerH: 0.02, tRefC: 60, eaKJ: 80, yield: 1, ref: "this-work", basis: "assumed" },
  ...(["egcg", "egc"] as const).map((id) => lose(id, "light", 0.004)),
];

const perSecToPerHour = 3600;
const cbReactions: Reaction[] = [
  { from: "thca", to: "d9thc", agent: "heat", kRefPerH: 0.18e-3 * perSecToPerHour, tRefC: 80, eaKJ: 88, yield: 1, ref: "wang2016", basis: "reported" },
  { from: "cbda", to: "cbd", agent: "heat", kRefPerH: 0.05e-3 * perSecToPerHour, tRefC: 80, eaKJ: 112, yield: 1, ref: "wang2016", basis: "reported" },
  { from: "cbga", to: "cbg", agent: "heat", kRefPerH: 0.06e-3 * perSecToPerHour, tRefC: 80, eaKJ: 109, yield: 1, ref: "wang2016", basis: "reported" },
  { from: "cbd", to: "d9thc", agent: "acid", kRefPerH: 0.03, tRefC: 60, eaKJ: 80, yield: 1, ref: "golombek2020", basis: "assumed" },
  { from: "cbd", to: "d8thc", agent: "acid", kRefPerH: 0.015, tRefC: 60, eaKJ: 80, yield: 1, ref: "golombek2020", basis: "assumed" },
  { from: "d9thc", to: "d8thc", agent: "acid", kRefPerH: 0.02, tRefC: 60, eaKJ: 80, yield: 1, ref: "golombek2020", basis: "assumed" },
  { from: "d9thc", to: "cbn", agent: "peroxide", kRefPerH: 0.05, tRefC: 25, eaKJ: 60, yield: 1, ref: "this-work", basis: "assumed" },
  { from: "d9thc", to: "cbn", agent: "light", kRefPerH: 0.001, tRefC: 25, eaKJ: 30, yield: 1, ref: "this-work", basis: "assumed" },
  { from: "cbd", to: "cbq", agent: "base", kRefPerH: 0.05, tRefC: 25, eaKJ: 60, yield: 1, ref: "this-work", basis: "assumed" },
  { from: "cbd", to: "cbq", agent: "peroxide", kRefPerH: 0.02, tRefC: 25, eaKJ: 60, yield: 1, ref: "this-work", basis: "assumed" },
];

const uv = (nm: number, rateHz = 10): Method["detector"] => ({ kind: "uv", nm, rateHz });
const cases: CaseDef[] = [
  {
    id: "greentea",
    title: "Green tea catechins",
    brief:
      "A supplier offers a green tea leaf extract with a label claim for EGCG and caffeine. Develop a reversed-phase method that separates the eight catechins and caffeine, show it is suitable, then determine the content of the lot you were sent and decide whether it meets its claim. Tea extracts carry other compounds, catechins epimerize and degrade, and the lot may not be what the label says.",
    product: { name: "Green tea leaf extract, powder", claim: [{ soluteId: "egcg", mgPerG: 450 }, { soluteId: "caf", mgPerG: 60 }], prepMg: 25, prepMl: 50 },
    analytes: ["caf", "gc", "egc", "c", "ec", "egcg", "gcg", "ecg", "cg"],
    extraStandards: ["ga", "tbm", "uracil"],
    composition: { egcg: [400, 480], ecg: [70, 110], egc: [60, 120], ec: [25, 50], gcg: [8, 20], gc: [5, 15], c: [5, 12], cg: [1, 4], caf: [50, 72] },
    matrix: { ga: [2, 6], tbm: [1, 4] },
    recovery: [0.93, 0.99],
    columns: ["gt-c18-spp4", "gt-c18-fpp35", "gt-c18-fpp17", "gt-pfp-spp4", "gt-pfp-spp19"],
    modifiers: ["MeCN"],
    buffers: ["formate", "phosphate", "acetate"],
    pH: { min: 2, max: 7, step: 0.1, note: "Before mixing with solvent B." },
    reactions: gtReactions,
    variants: [
      { id: "clean", label: "Lot as labelled. Nothing unusual." },
      { id: "interferent", label: "A matrix compound co-elutes with EGCG under the starting gradient (5 to 40% B in 30 min at 1 mL/min) and moves away from it when the gradient slope changes. Because the overlap is exact there, a purity check across the peak does not flag it. What gives it away: the peak spectrum has a band near 325 nm that an EGCG standard lacks, its mass differs, and it separates from EGCG on a steeper or shallower gradient. Uncorrected, EGCG reads about 10% high.", add: { gtx: 70 } },
      { id: "heated", label: "The extract was held hot in solution during manufacture (72 h at 60 \u00b0C): part of the EGCG has epimerized to GCG, and likewise for the other epimer pairs.", stress: { agent: "heat", hours: 72, tempC: 60 } },
      { id: "short", label: "Under-strength in EGCG (about 60% of the usual content) with added caffeine.", scale: { egcg: 0.6 }, add: { caf: 60 } },
    ],
    ratios: [{ label: "EGCG to caffeine", num: "egcg", den: "caf" }, { label: "EGCG to ECG", num: "egcg", den: "ecg" }],
    totals: [{ label: "Total catechins (sum of eight)", terms: ["gc", "egc", "c", "ec", "egcg", "gcg", "ecg", "cg"].map((id) => ({ id, factor: 1 })) }],
    defaultMethod: { columnId: "gt-c18-spp4", modifier: "MeCN", pH: 2.7, buffer: "formate", tempC: GT_START.tempC, flowMlMin: GT_START.flow, program: GT_START.program, runTimeMin: 35, injUl: 5, detector: uv(280) },
    diluentPhi: 0.05,
  },
  {
    id: "cannabis",
    title: "Hemp cannabinoids",
    brief:
      "A grower submits dried, milled hemp flower for potency testing. Develop a method that separates the acidic and neutral cannabinoids, in particular d9-THC from d8-THC and the acids from the neutral cannabinoids they elute among, show it is suitable, then report the content and decide whether total THC is within the 3 mg/g (0.3%) limit. Acidic cannabinoids decarboxylate on heating, CBD can convert under acid, and several of these compounds share one mass.",
    product: { name: "Hemp flower, dried and milled", claim: [{ soluteId: "cbda", mgPerG: 85 }], prepMg: 100, prepMl: 50 },
    analytes: ["cbda", "cbga", "cbg", "cbd", "thcv", "cbn", "d9thc", "d8thc", "cbc", "thca"],
    extraStandards: ["uracil"],
    composition: { cbda: [65, 105], cbd: [8, 22], thca: [1.6, 3.4], d9thc: [0.4, 1.0], cbga: [1.5, 4], cbg: [0.4, 1.2], cbc: [0.4, 1.0], cbn: [0.08, 0.3], thcv: [0.05, 0.15], d8thc: [0, 0] },
    matrix: {},
    recovery: [0.92, 0.99],
    columns: ["cb-c18", "cb-c18sp", "cb-carb", "cb-amide"],
    modifiers: ["MeCN"],
    buffers: ["formate", "acetate", "phosphate"],
    pH: { min: 2.5, max: 5.5, step: 0.05, note: "Before mixing with solvent B. Retention data covers pH 3.0 to 3.8." },
    reactions: cbReactions,
    variants: [
      { id: "clean", label: "Lot as submitted. Nothing unusual." },
      { id: "hot", label: "High in THCA: total THC is over the limit unless THCA is ignored.", scale: { thca: 1.7 } },
      { id: "aged", label: "Stored in light for three weeks: about 40% of the d9-THC has oxidized to CBN. The acids are unchanged.", stress: { agent: "light", hours: 500, tempC: 25 } },
      { id: "d8", label: "Contains d8-THC (4 mg/g), which has the same mass as d9-THC and elutes next to it.", add: { d8thc: 4 } },
    ],
    ratios: [{ label: "CBDA to CBD (extent of decarboxylation)", num: "cbda", den: "cbd" }],
    totals: [
      { label: "Total THC = d9-THC + 0.877 x THCA", terms: [{ id: "d9thc", factor: 1 }, { id: "thca", factor: 0.877 }], limit: { kind: "max", mgPerG: 3, text: "limit 3 mg/g (0.3%)" } },
      { label: "Total CBD = CBD + 0.877 x CBDA", terms: [{ id: "cbd", factor: 1 }, { id: "cbda", factor: 0.877 }] },
    ],
    defaultMethod: { columnId: "cb-c18", modifier: "MeCN", pH: 3.0, buffer: "formate", tempC: 30, flowMlMin: 0.3, program: [{ t: 0, phi: 0.7 }], runTimeMin: 20, injUl: 3, detector: uv(230) },
    diluentPhi: 0.8,
  },
];

out("references", references);
out("instruments", instruments);
out("columns", columns);
out("solutes", solutes);
out("literature", literature);
out("checks", checks);
out("cases", cases);
console.log(`wrote ${solutes.length} solutes, ${columns.length} columns, ${literature.length} literature methods, ${checks.length} checks, ${cases.length} cases`);
console.log("CBD UV shape:", cbdShape.map((b) => `${b.nm} nm eps ${b.eps} w ${b.width}`).join("; "));
for (const c of checks as Array<{ quantity: string; published: string; model: string }>) console.log(` check: ${c.quantity} | published ${c.published} | model ${c.model}`);
