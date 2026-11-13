// Fits the pH response of the acidic cannabinoids to points digitized from
// Owolabi et al. 2025, Figure 4, and recomputes slopes from Figures 1 and 2 where
// the printed legend disagrees with the plotted points.
//   k(pH) = k_HA (1 + r x) / (1 + x),  x = 10^(pH - pKa_app)
// pKa_app is an apparent value on the aqueous-pH scale at the panel's acetonitrile content.
// Run: node tools/fit-cannabinoid-ph.ts   (writes tools/out/cannabinoid-ph.json)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { K70, SLOPE, CB_COLUMNS } from "./cannabinoid-data.ts";
import { levenbergMarquardt } from "./lm.ts";

/** Retention of the anion relative to the neutral acid. Not determined by the data (pH range too narrow); assumed. */
export const ANION_RATIO = 0.03;

interface Panel {
  panel: string;
  acetonitrile_pct?: number;
  series: Array<{ compound: string; points: Array<{ pH?: number; acetonitrile_pct?: number; logk: number }> }>;
}
const read = (n: string): { panels: Panel[] } => JSON.parse(readFileSync(new URL(`./data/${n}.json`, import.meta.url), "utf8")) as { panels: Panel[] };
const COLUMN: Record<string, string> = { A: "cb-c18", B: "cb-c18sp", C: "cb-carb", D: "cb-amide" };
const ID: Record<string, string> = { CBDA: "cbda", CBGA: "cbga", "d9-THCA": "thca", CBG: "cbg", CBD: "cbd", THCV: "thcv", CBN: "cbn", "d9-THC": "d9thc", "d8-THC": "d8thc", CBC: "cbc" };
const colIndex = (col: string): number => CB_COLUMNS.indexOf(col as (typeof CB_COLUMNS)[number]);

// Slopes of log k against acetonitrile fraction from the plotted points.
const slopes: Record<string, Record<string, { digitized: number; printed: number; n: number }>> = {};
for (const fig of ["figure1_neutral", "figure2_acidic"]) {
  for (const p of read(fig).panels) {
    const col = COLUMN[p.panel]!;
    for (const s of p.series) {
      const id = ID[s.compound];
      if (!id || s.points.length < 3) continue;
      const xs = s.points.map((q) => q.acetonitrile_pct! / 100);
      const ys = s.points.map((q) => q.logk);
      const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
      const my = ys.reduce((a, v) => a + v, 0) / ys.length;
      const b = xs.reduce((a, v, i) => a + (v - mx) * (ys[i]! - my), 0) / xs.reduce((a, v) => a + (v - mx) ** 2, 0);
      (slopes[col] ??= {})[id] = { digitized: b, printed: SLOPE[id]![colIndex(col)]!, n: xs.length };
    }
  }
}

const ph: Record<string, Record<string, { pKa: number; logkHA: number; phi: number; rms: number; n: number }>> = {};
for (const p of read("figure4_pH").panels) {
  const col = COLUMN[p.panel]!;
  for (const s of p.series) {
    const id = ID[s.compound];
    if (!id || s.points.length < 3) continue;
    const model = (q: number[], pH: number): number => {
      const x = Math.pow(10, pH - q[1]!);
      return q[0]! + Math.log10((1 + ANION_RATIO * x) / (1 + x));
    };
    const { p: q, sse } = levenbergMarquardt((v) => s.points.map((pt) => model(v, pt.pH!) - pt.logk), [s.points[0]!.logk + 0.05, 3.8], 300);
    (ph[col] ??= {})[id] = { pKa: q[1]!, logkHA: q[0]!, phi: p.acetonitrile_pct! / 100, rms: Math.sqrt(sse / s.points.length), n: s.points.length };
  }
}

// pH of 0.02% formic acid (the A solvent of Tables 1 and 2), implied by requiring the tabulated k,
// moved to the panel's acetonitrile content with the slope, to lie on the fitted pH curve.
const implied: number[] = [];
for (const [col, byId] of Object.entries(ph)) {
  for (const [id, f] of Object.entries(byId)) {
    const slope = slopes[col]?.[id]?.digitized ?? SLOPE[id]![colIndex(col)]!;
    const logkTable = Math.log10(K70[id]![colIndex(col)]!) + slope * (f.phi - 0.7);
    const ratio = Math.pow(10, logkTable - f.logkHA); // (1 + r x) / (1 + x)
    if (ratio >= 1 || ratio <= ANION_RATIO) continue;
    const x = (1 - ratio) / (ratio - ANION_RATIO);
    implied.push(f.pKa + Math.log10(x));
  }
}
implied.sort((a, b) => a - b);
const phTable = implied.length ? implied[Math.floor(implied.length / 2)]! : NaN;

console.log("pH response (apparent pKa at the panel's acetonitrile content):");
for (const [col, byId] of Object.entries(ph)) console.log(` ${col}: ` + Object.entries(byId).map(([id, f]) => `${id} pKa ${f.pKa.toFixed(2)} (rms ${f.rms.toFixed(4)}, n ${f.n})`).join("; "));
console.log(`implied pH of 0.02% formic acid: median ${phTable.toFixed(2)} from ${implied.length} series, range ${implied[0]?.toFixed(2)} to ${implied[implied.length - 1]?.toFixed(2)}`);
console.log("slopes where points and legend differ by more than 0.05:");
for (const [col, byId] of Object.entries(slopes)) for (const [id, s] of Object.entries(byId)) if (Math.abs(s.digitized - s.printed) > 0.05) console.log(` ${col} ${id}: points ${s.digitized.toFixed(2)}, legend ${s.printed.toFixed(2)} (n ${s.n})`);

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/cannabinoid-ph.json", import.meta.url), JSON.stringify({ anionRatio: ANION_RATIO, phTable, impliedRange: [implied[0], implied[implied.length - 1]], ph, slopes }, null, 1));
