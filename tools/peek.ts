// Developer aid: print where everything elutes for a case's starting method.
import { readFileSync } from "node:fs";
import { integrate } from "../src/engine/integrate.ts";
import { simulateRun } from "../src/engine/simulate.ts";
import type { Column, Instrument, Method, Solute } from "../src/engine/types.ts";
import type { CaseDef } from "../src/lab/types.ts";
const load = <T>(n: string): T => JSON.parse(readFileSync(new URL(`../src/data/${n}.json`, import.meta.url), "utf8")) as T;
const solutes = new Map(load<Solute[]>("solutes").map((s) => [s.id, s]));
const columns = new Map(load<Column[]>("columns").map((c) => [c.id, c]));
const inst = load<Instrument[]>("instruments");
for (const c of load<CaseDef[]>("cases")) {
  for (const colId of c.columns) {
    const method: Method = { ...c.defaultMethod, columnId: colId };
    const column = columns.get(colId)!;
    for (const instrument of inst) {
      try {
        const t = performance.now();
        const run = simulateRun({ method, instrument, column, sample: { id: "s", label: "s", diluentPhi: c.diluentPhi, components: c.analytes.map((soluteId) => ({ soluteId, ugPerMl: 20 })) }, solutes, seed: "peek" });
        const res = integrate(run.time, run.signal);
        console.log(`${c.id} ${colId} ${instrument.id}: P ${run.pressureBarMax.toFixed(0)} bar, t0 ${run.t0.toFixed(2)}, ${res.peaks.length}/${c.analytes.length} peaks, ${(performance.now() - t).toFixed(0)} ms`);
        console.log("   true: " + run.peaks.sort((a, b) => a.tR - b.tR).map((p) => `${p.soluteId} ${p.eluted ? p.tR.toFixed(2) : "late"}`).join(", "));
        console.log("   found: " + res.peaks.map((p) => `${p.tR.toFixed(2)}(Rs ${Number.isFinite(p.resolution) ? p.resolution.toFixed(1) : "-"}, N ${Math.round(p.plates)}, As ${p.symmetry.toFixed(2)})`).join(" "));
        if (run.warnings.length) console.log("   warn: " + run.warnings.join(" | "));
      } catch (e) {
        console.log(`${c.id} ${colId} ${instrument.id}: ${(e as Error).message}`);
      }
    }
  }
}
