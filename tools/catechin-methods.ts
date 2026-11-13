// Published reversed-phase methods for green tea catechins and methylxanthines,
// transcribed from the sources in docs/DATA.md. Retention times are as printed.
// Dwell volume and porosity are NOT reported by any source; the values here are
// assumptions by instrument and particle class and are flagged as such in the data set.

export interface PublishedMethod {
  id: string;
  ref: string;
  locus: string;
  label: string;
  phase: "C18" | "PFP";
  /** Source column, as named in the paper. */
  sourceColumn: string;
  lengthMm: number;
  idMm: number;
  particleUm: number;
  particleType: "FPP" | "SPP";
  flow: number;
  tempC: number;
  /** [time min, organic volume fraction]. */
  program: Array<[number, number]>;
  dwellMl: number;
  aqueous: string;
  rt: Record<string, number>;
}

/** Assumed total porosity by particle class. */
export const POROSITY = { FPP: 0.62, SPP: 0.52 } as const;

export const METHODS: PublishedMethod[] = [
  {
    id: "heliyon2024",
    ref: "heliyon2024",
    locus: "Section 2.3 and Table 2 (standard solution, intraday)",
    label: "C18 5 µm, 250 x 4.0 mm, 20 to 40% MeCN, 0.1% phosphoric acid",
    phase: "C18",
    sourceColumn: "Purospher STAR RP-18 end-capped",
    lengthMm: 250, idMm: 4.0, particleUm: 5, particleType: "FPP",
    flow: 1.0, tempC: 30,
    program: [[0, 0.20], [1, 0.20], [5, 0.25], [15, 0.30], [25, 0.40]],
    dwellMl: 1.0,
    aqueous: "0.1% phosphoric acid",
    rt: { ga: 3.97, gc: 4.61, tbm: 5.39, tep: 8.39, c: 9.05, caf: 11.2, egcg: 12.1, ec: 13.2, gcg: 14.4, ecg: 16.6, cg: 18.1 },
  },
  {
    id: "molecules3485-c18",
    ref: "molecules2021-3485",
    locus: "Supplementary Table S1 and Figure S1",
    label: "C18 superficially porous 4 µm, 250 x 4.6 mm, 10 to 25% MeCN, 0.1% formic acid",
    phase: "C18",
    sourceColumn: "InfinityLab Poroshell 120 EC-C18",
    lengthMm: 250, idMm: 4.6, particleUm: 4, particleType: "SPP",
    flow: 0.5, tempC: 25,
    program: [[0, 0.10], [5, 0.10], [50, 0.25]],
    dwellMl: 1.0,
    aqueous: "0.1% formic acid",
    rt: { gc: 10.035, egc: 15.89, caf: 18.648, c: 19.694, ec: 26.926, egcg: 27.922, gcg: 30.81, ecg: 41.214, cg: 42.129 },
  },
  {
    id: "pedan2018",
    ref: "pedan2018",
    locus: "Section 2.4 and Table 2",
    label: "C18 3.5 µm, 150 x 3.0 mm, multi-step 3 to 50% B, 0.1% formic acid",
    phase: "C18",
    sourceColumn: "Eclipse XDB-C18",
    lengthMm: 150, idMm: 3.0, particleUm: 3.5, particleType: "FPP",
    flow: 0.25, tempC: 38,
    // B is acetonitrile-water-formic acid 94.9:5:0.1, so organic fraction = 0.949 x %B.
    program: ([[0, 3], [5, 3], [8, 6], [20, 11], [25, 12], [32, 17], [38, 20], [44, 28], [47, 31], [51, 38], [54, 45], [58, 50], [61, 90], [63, 90]] as Array<[number, number]>).map(([t, b]) => [t, (0.949 * b) / 100]),
    dwellMl: 0.6,
    aqueous: "0.1% formic acid",
    rt: { ga: 9.4, gc: 15.0, tbm: 15.2, egc: 22.0, c: 23.8, caf: 25.4, ec: 31.1, egcg: 31.7, gcg: 34.3, ecg: 40.3, cg: 41.1 },
  },
  {
    id: "xiao2021",
    ref: "xiao2021",
    locus: "Section 2.4 and Table 2",
    label: "C18 1.7 µm, 100 x 2.1 mm, 5 to 50% MeCN, 0.2% formic acid",
    phase: "C18",
    sourceColumn: "ACQUITY UPLC BEH C18",
    lengthMm: 100, idMm: 2.1, particleUm: 1.7, particleType: "FPP",
    flow: 0.3, tempC: 40,
    program: [[0, 0.05], [15, 0.05], [35, 0.15], [50, 0.50], [60, 0.80]],
    dwellMl: 0.15,
    aqueous: "0.2% formic acid",
    rt: { ga: 2.25, gc: 3.35, tbm: 3.45, tep: 5.3, egc: 7.0, c: 8.7, caf: 11.0, ec: 19.4, egcg: 19.8, gcg: 24.0, ecg: 31.3, cg: 32.6 },
  },
  {
    id: "jin2019",
    ref: "jin2019",
    locus: "Section 2.4 and Table 1",
    label: "C18 1.8 µm, 100 x 2.1 mm, 5 to 18% MeCN, 0.3% formic acid",
    phase: "C18",
    sourceColumn: "ZORBAX Eclipse Plus C18",
    lengthMm: 100, idMm: 2.1, particleUm: 1.8, particleType: "FPP",
    flow: 0.3, tempC: 30,
    program: [[0, 0.05], [1, 0.10], [10, 0.18], [14, 1.0], [17, 1.0]],
    dwellMl: 0.12,
    aqueous: "0.3% formic acid",
    rt: { ga: 1.69, gc: 2.25, egc: 3.16, c: 3.78, ec: 5.36, egcg: 5.66, gcg: 6.43, ecg: 9.42, cg: 9.8 },
  },
  {
    id: "chen2018",
    ref: "chen2018",
    locus: "Section 2.3 and Table 1",
    label: "C18 (T3) 1.8 µm, 100 x 2.1 mm, 1 to 40% MeCN, 0.1% formic acid",
    phase: "C18",
    sourceColumn: "Acquity UPLC HSS T3",
    lengthMm: 100, idMm: 2.1, particleUm: 1.8, particleType: "FPP",
    flow: 0.3, tempC: 40,
    program: [[0, 0.01], [2, 0.07], [13, 0.40], [14, 0.99], [17, 0.99]],
    dwellMl: 0.12,
    aqueous: "0.1% formic acid",
    rt: { gc: 3.84, egc: 4.93, c: 5.36, ec: 6.28, egcg: 6.35, ecg: 7.86, tbm: 3.8, caf: 5.6 },
  },
  {
    id: "foods2026",
    ref: "foods2026",
    locus: "Section 2.3 and Figure 2 peak labels (agreeing with the text)",
    label: "C18 superficially porous 2.7 µm, 50 x 4.6 mm, 7% MeCN hold then to 70%, 0.1% formic acid",
    phase: "C18",
    sourceColumn: "CORTECS C18",
    lengthMm: 50, idMm: 4.6, particleUm: 2.7, particleType: "SPP",
    flow: 0.8, tempC: 30,
    program: [[0, 0.07], [4, 0.07], [8, 0.70]],
    dwellMl: 0.7,
    aqueous: "0.1% formic acid",
    rt: { tbm: 1.145, tep: 1.677, caf: 3.246 },
  },
  {
    id: "molecules3485-pfp-short",
    ref: "molecules2021-3485",
    locus: "Section 4.3 and Table 1",
    label: "PFP superficially porous 1.9 µm, 50 x 2.1 mm, 5 to 30% MeCN in 5 min, 2% formic acid",
    phase: "PFP",
    sourceColumn: "InfinityLab Poroshell 120 PFP",
    lengthMm: 50, idMm: 2.1, particleUm: 1.9, particleType: "SPP",
    flow: 0.5, tempC: 25,
    program: [[0, 0.05], [5, 0.30], [6, 0.95], [10, 0.95]],
    dwellMl: 1.0,
    aqueous: "2% formic acid",
    rt: { gc: 1.14, caf: 1.73, egc: 2.2, c: 2.48, ec: 3.45, egcg: 4.24, gcg: 4.49, ecg: 4.98, cg: 5.19 },
  },
  {
    id: "molecules3485-pfp-long",
    ref: "molecules2021-3485",
    locus: "Supplementary Table S2 and Figure S1",
    label: "PFP superficially porous 4 µm, 250 x 4.6 mm, 10 to 25% MeCN, 0.1% formic acid",
    phase: "PFP",
    sourceColumn: "InfinityLab Poroshell 120 PFP",
    lengthMm: 250, idMm: 4.6, particleUm: 4, particleType: "SPP",
    flow: 0.5, tempC: 25,
    program: [[0, 0.10], [5, 0.10], [50, 0.25]],
    dwellMl: 1.0,
    aqueous: "0.1% formic acid",
    rt: { gc: 14.342, caf: 18.195, egc: 20.072, c: 23.995, ec: 29.001, egcg: 35.513, gcg: 38.266, ecg: 46.373, cg: 48.64 },
  },
];

export function deadTime(m: PublishedMethod): number {
  return (POROSITY[m.particleType] * Math.PI * (m.idMm / 20) ** 2 * (m.lengthMm / 10)) / m.flow;
}
