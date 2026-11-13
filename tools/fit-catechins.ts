// Joint fit of catechin and methylxanthine retention on C18 across published methods.
//   ln k(i, m, phi) = lnkw_i - S_i phi + delta_m + (-dH / R)(1/T_m - 1/T_ref)
// lnkw_i and S_i belong to the compound, delta_m to the column of method m.
// Run: node tools/fit-catechins.ts   (writes tools/out/catechins-fit.json)

import { mkdirSync, writeFileSync } from "node:fs";
import { programTime } from "../src/engine/gradient.ts";
import { deadTime, METHODS, type PublishedMethod } from "./catechin-methods.ts";
import { levenbergMarquardt } from "./lm.ts";

export const T_REF = 30;
/** Assumed enthalpy of transfer, kJ/mol. No open temperature series exists for these compounds. */
export const DH = -15;
const R = 8.314462618e-3;

const tempShift = (tempC: number): number => (-DH / R) * (1 / (tempC + 273.15) - 1 / (T_REF + 273.15));
const program = (m: PublishedMethod) => m.program.map(([t, phi]) => ({ t, phi }));

/** Shared Neue-Kuss curvature. Set by the --s2 argument; 0 gives the linear model. */
export const S2 = Number(process.argv.find((a) => a.startsWith("--s2="))?.slice(5) ?? 0);

function predict(m: PublishedMethod, lnkw: number, S: number, delta: number, s2 = S2): number {
  const a = lnkw + delta + tempShift(m.tempC);
  return programTime((phi) => Math.exp(a + 2 * Math.log(1 + s2 * phi) - (S * phi) / (1 + s2 * phi)), program(m), deadTime(m), m.dwellMl / m.flow);
}

interface Global {
  compounds: string[];
  lnkw: Record<string, number>;
  S: Record<string, number>;
  delta: Record<string, number>;
  rms: number;
}

function fitGlobal(methods: PublishedMethod[], reference: string): Global {
  const compounds = [...new Set(methods.flatMap((m) => Object.keys(m.rt)))].filter((c) => methods.filter((m) => c in m.rt).length >= 2);
  const free = methods.filter((m) => m.id !== reference);
  const unpack = (p: number[]) => {
    const lnkw: Record<string, number> = {};
    const S: Record<string, number> = {};
    const delta: Record<string, number> = { [reference]: 0 };
    compounds.forEach((c, i) => {
      lnkw[c] = p[2 * i]!;
      S[c] = p[2 * i + 1]!;
    });
    free.forEach((m, j) => {
      delta[m.id] = p[2 * compounds.length + j]!;
    });
    return { lnkw, S, delta };
  };
  const residuals = (p: number[]): number[] => {
    const { lnkw, S, delta } = unpack(p);
    const out: number[] = [];
    for (const m of methods) {
      for (const c of compounds) {
        const obs = m.rt[c];
        if (obs === undefined) continue;
        const pred = predict(m, lnkw[c]!, S[c]!, delta[m.id]!);
        // Relative error in retention time, so short and long methods weigh alike.
        out.push(Number.isFinite(pred) ? Math.log(pred / obs) : 5);
      }
    }
    // Weak prior keeping S in the range seen for small molecules; it only matters where data cannot decide.
    for (const c of compounds) out.push(0.02 * (S[c]! - 12));
    return out;
  };
  const start = [...compounds.flatMap(() => [3, 12]), ...free.map(() => 0)];
  const { p } = levenbergMarquardt(residuals, start, 400);
  const u = unpack(p);
  const res = residuals(p).slice(0, -compounds.length);
  return { compounds, ...u, rms: Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length) };
}

const c18 = METHODS.filter((m) => m.phase === "C18");
const REF = "molecules3485-c18";
const global = fitGlobal(c18, REF);

console.log(`S2 = ${S2}`);
console.log(`Global C18 fit: ${global.compounds.length} compounds, ${c18.length} methods, rms relative tR error ${(100 * global.rms).toFixed(1)}%`);
console.log("compound  lnkw    S");
for (const c of global.compounds) console.log(`${c.padEnd(8)} ${global.lnkw[c]!.toFixed(2).padStart(6)} ${global.S[c]!.toFixed(1).padStart(6)}`);
console.log("delta:", Object.fromEntries(Object.entries(global.delta).map(([k, v]) => [k, Number(v.toFixed(2))])));

// Per-method table: global prediction and the per-compound column correction epsilon that reproduces the paper.
const epsilon: Record<string, Record<string, number>> = {};
const perMethod: Array<{ id: string; rows: Array<{ c: string; obs: number; pred: number }>; orderOk: boolean }> = [];
for (const m of c18) {
  epsilon[m.id] = {};
  const rows: Array<{ c: string; obs: number; pred: number }> = [];
  for (const [c, obs] of Object.entries(m.rt)) {
    if (!(c in global.lnkw)) continue;
    const pred = predict(m, global.lnkw[c]!, global.S[c]!, global.delta[m.id]!);
    rows.push({ c, obs, pred });
    // Solve for epsilon by bisection: tR is monotone in ln k.
    let lo = -3;
    let hi = 3;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const t = predict(m, global.lnkw[c]! + mid, global.S[c]!, global.delta[m.id]!);
      if (!Number.isFinite(t) || t > obs) hi = mid;
      else lo = mid;
    }
    epsilon[m.id]![c] = (lo + hi) / 2;
  }
  const byObs = [...rows].sort((a, b) => a.obs - b.obs).map((r) => r.c).join(",");
  const byPred = [...rows].sort((a, b) => a.pred - b.pred).map((r) => r.c).join(",");
  perMethod.push({ id: m.id, rows, orderOk: byObs === byPred });
}

// Leave-one-method-out: refit without each method, then predict it with only its column offset fitted.
const loo: Array<{ id: string; rmsPct: number; maxPct: number; rows: Array<{ c: string; obs: number; pred: number }>; orderMatches: number; pairs: number }> = [];
for (const held of c18) {
  if (Object.keys(held.rt).length < 4) continue;
  const rest = c18.filter((m) => m.id !== held.id);
  const ref = held.id === REF ? "pedan2018" : REF;
  const g = fitGlobal(rest, ref);
  const cs = Object.keys(held.rt).filter((c) => c in g.lnkw);
  // One free parameter for the held-out column: its overall strength.
  const { p } = levenbergMarquardt((q) => cs.map((c) => { const t = predict(held, g.lnkw[c]!, g.S[c]!, q[0]!); return Number.isFinite(t) ? Math.log(t / held.rt[c]!) : 5; }), [0], 100);
  const rows = cs.map((c) => ({ c, obs: held.rt[c]!, pred: predict(held, g.lnkw[c]!, g.S[c]!, p[0]!) }));
  const errs = rows.map((r) => Math.abs(r.pred / r.obs - 1));
  let orderMatches = 0;
  let pairs = 0;
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    pairs++;
    if (Math.sign(rows[i]!.obs - rows[j]!.obs) === Math.sign(rows[i]!.pred - rows[j]!.pred)) orderMatches++;
  }
  loo.push({ id: held.id, rmsPct: 100 * Math.sqrt(errs.reduce((s, v) => s + v * v, 0) / errs.length), maxPct: 100 * Math.max(...errs), rows, orderMatches, pairs });
}
console.log("\nLeave-one-method-out (column strength fitted, selectivity predicted):");
for (const l of loo) console.log(`${l.id.padEnd(20)} rms ${l.rmsPct.toFixed(1)}%  max ${l.maxPct.toFixed(1)}%  pair order ${l.orderMatches}/${l.pairs}`);

// PFP: two gradients on one phase determine lnkw and S per compound directly.
const pfp = METHODS.filter((m) => m.phase === "PFP");
const pfpFit: Record<string, { lnkw: number; S: number; rmsPct: number }> = {};
for (const c of Object.keys(pfp[0]!.rt)) {
  const { p, sse } = levenbergMarquardt((q) => pfp.map((m) => { const t = predict(m, q[0]!, q[1]!, 0); return Number.isFinite(t) ? Math.log(t / m.rt[c]!) : 5; }), [3, 12], 300);
  pfpFit[c] = { lnkw: p[0]!, S: p[1]!, rmsPct: 100 * Math.sqrt(sse / pfp.length) };
}
console.log("\nPFP (two gradients, direct):");
for (const [c, f] of Object.entries(pfpFit)) console.log(`${c.padEnd(8)} lnkw ${f.lnkw.toFixed(2)}  S ${f.S.toFixed(1)}  rms ${f.rmsPct.toFixed(2)}%`);

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/catechins-fit.json", import.meta.url), JSON.stringify({ tRef: T_REF, dH: DH, reference: REF, global, epsilon, perMethod, loo, pfpFit }, null, 1));
