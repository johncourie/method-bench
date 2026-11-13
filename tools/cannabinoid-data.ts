// Owolabi et al., Molecules 2025, 30, 758 (CC BY 4.0).
// K70: retention factors at 70.0% (v/v) acetonitrile, A solvent 0.02% formic acid, 30 degC (Tables 1 and 2).
// SLOPE: slope of log10 k versus acetonitrile volume fraction (legends of Figures 1 and 2).
// Column order in every row: carbamate (Cortecs Shield RP-18), sterically protected C18 (Raptor ARC-18),
// C18 (Poroshell 120 EC-C18), amide (Ascentis Express RP-Amide).

export const CB_COLUMNS = ["cb-carb", "cb-c18sp", "cb-c18", "cb-amide"] as const;

export const K70: Record<string, [number, number, number, number]> = {
  cbg: [3.43, 3.3, 3.96, 6.49],
  cbd: [3.01, 3.47, 4.24, 5.44],
  thcv: [3.01, 3.72, 4.76, 5.19],
  cbn: [4.75, 5.79, 7.56, 8.97],
  d9thc: [5.7, 7.6, 10.05, 10.25],
  d8thc: [6.04, 7.94, 10.56, 11.11],
  cbc: [7.77, 10.15, 13.95, 14.88],
  cbda: [3.55, 2.16, 2.72, 10.83],
  cbga: [5.23, 2.65, 3.03, 16.75],
  thca: [9.58, 9.33, 12.09, 26.89],
};

/** As printed. The amide-column neutral slopes are printed identical to the C18 panel's; see docs/DATA.md. */
export const SLOPE: Record<string, [number, number, number, number]> = {
  cbg: [-4.37, -4.15, -4.04, -4.04],
  cbd: [-4.13, -3.9, -3.86, -3.86],
  thcv: [-3.59, -3.43, -3.43, -3.43],
  cbn: [-4.1, -3.91, -3.89, -3.89],
  d9thc: [-4.09, -3.9, -3.88, -3.88],
  d8thc: [-4.13, -3.95, -3.93, -3.93],
  cbc: [-4.34, -4.15, -4.14, -4.14],
  cbda: [-3.77, -3.41, -4.16, -3.46],
  cbga: [-4.04, -4.06, -4.39, -3.76],
  thca: [-3.83, -3.84, -3.97, -3.5],
};

/** Mandrioli et al., Molecules 2019, 24, 2113 (CC BY 4.0): calibration slopes at 220 nm, area per ug/mL (Section 2.2.7). */
export const SLOPE_220: Record<string, number> = { cbda: 18955, cbga: 19796, cbg: 18094, cbd: 13703, thcv: 18534, cbn: 34148, d9thc: 19893, d8thc: 17526, cbc: 18590, thca: 18239 };

/** Analakkattillam et al., Sci Rep 2022, 12, 12453 (CC BY 4.0), Table 1b: CBD peak area versus wavelength. */
export const CBD_AREA_BY_NM: Array<[number, number]> = [[214, 374090], [228, 136453], [230, 122916], [240, 46056], [280, 10291]];
