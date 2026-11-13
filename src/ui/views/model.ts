// Fit and predict: the student builds a retention model from their own runs.

import { fitLss, predictBand, resolutionOf, type LssFit, type Observation } from "../../engine/fit.ts";
import type { GradientPoint } from "../../engine/types.ts";
import { describeSpec } from "../../lab/samples.ts";
import { methodKey } from "../../lab/session.ts";
import type { App } from "../app.ts";
import { field, fixed, h, numberInput } from "../dom.ts";
import { estimatedColumnVolumeMl, methodSummary } from "./instrument.ts";

interface Fitted {
  soluteId: string;
  fit: LssFit;
  obs: Array<{ runId: number; tR: number }>;
}

function fitAll(app: App, vm: number): { fits: Fitted[]; problems: string[] } {
  const runs = app.lab.session.runs.filter((r) => app.fitRuns.has(r.id));
  const problems: string[] = [];
  if (runs.length < 2) return { fits: [], problems: ["Tick at least two runs that differ in gradient time or in % B."] };
  const base = runs[0]!.method;
  if (runs.some((r) => r.method.columnId !== base.columnId || r.method.modifier !== base.modifier || r.method.pH !== base.pH || r.method.tempC !== base.tempC)) {
    problems.push("The ticked runs differ in column, solvent, pH or temperature. One model describes one such set of conditions.");
  }
  const dwell = app.lab.instrument.dwellMl;
  const byName = new Map<string, Array<Observation & { runId: number }>>();
  for (const r of runs) {
    const ex = app.lab.execute(r);
    const seen = new Map<string, number>();
    for (const p of ex.integration.peaks) {
      const name = ex.names.get(p.n);
      if (!name) continue;
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    for (const p of ex.integration.peaks) {
      const name = ex.names.get(p.n);
      if (!name || seen.get(name) !== 1) continue;
      const list = byName.get(name) ?? [];
      list.push({ runId: r.id, program: r.method.program, t0: vm / r.method.flowMlMin, tD: dwell / r.method.flowMlMin, tR: p.tR });
      byName.set(name, list);
    }
  }
  const fits: Fitted[] = [];
  for (const [soluteId, obs] of byName) {
    if (obs.length < 2) continue;
    const fit = fitLss(obs);
    if (fit) fits.push({ soluteId, fit, obs: obs.map((o) => ({ runId: o.runId, tR: o.tR })) });
    else problems.push(`${app.soluteName(soluteId)}: these runs do not determine a model. The peak must elute at clearly different % B in at least two runs, later than the column volume you entered, and the result must be a possible retention model. Replicate runs, a peak that leaves before the gradient reaches it, or a wrong column volume all end here.`);
  }
  if (fits.length === 0 && problems.length === 0) problems.push("No peak carries the same name in two of the ticked runs. Name the peaks on the Instrument tab first.");
  return { fits, problems };
}

function predictFor(fits: Fitted[], plates: number, program: readonly GradientPoint[], t0: number, tD: number, tMax: number, steps = 400): Array<{ soluteId: string; tR: number; sigma: number }> {
  const out: Array<{ soluteId: string; tR: number; sigma: number }> = [];
  for (const f of fits) {
    const b = predictBand(f.fit.lnkw, f.fit.S, plates, program, t0, tD, tMax, steps);
    if (b) out.push({ soluteId: f.soluteId, ...b });
  }
  return out.sort((a, b) => a.tR - b.tR);
}

function criticalRs(bands: Array<{ tR: number; sigma: number }>): number {
  let rs = Infinity;
  for (let i = 1; i < bands.length; i++) rs = Math.min(rs, resolutionOf(bands[i - 1]!, bands[i]!));
  return rs;
}

export function modelView(app: App): HTMLElement {
  const runs = app.lab.session.runs;
  if (runs.length === 0) return h("section", { class: "panel" }, h("h1", {}, "Fit and predict"), h("p", { class: "muted" }, "Make some injections first."));
  const m = app.method;
  const col = app.lab.column(m.columnId);
  const vm = app.fitT0 ?? estimatedColumnVolumeMl(col);
  const { fits, problems } = fitAll(app, vm);
  const t0 = vm / m.flowMlMin;
  const tD = app.lab.instrument.dwellMl / m.flowMlMin;

  const runRows = runs.map((r) => {
    const cb = h("input", { type: "checkbox", checked: app.fitRuns.has(r.id) });
    cb.id = `fit-${r.id}`;
    cb.setAttribute("aria-label", `Use run ${r.id} in the fit`);
    cb.addEventListener("change", () => {
      if (cb.checked) app.fitRuns.add(r.id);
      else app.fitRuns.delete(r.id);
      app.refresh();
    });
    const named = app.lab.execute(r).names.size;
    return h("tr", {}, h("th", { scope: "row" }, String(r.id)), h("td", {}, cb), h("td", { class: "l wrap" }, describeSpec(r.spec, app.catalog.solutes)), h("td", { class: "l wrap" }, methodSummary(app, r.method)), h("td", {}, String(named)));
  });

  const fitRows = fits.map((f) => h("tr", {}, h("th", { scope: "row" }, app.soluteName(f.soluteId)), h("td", {}, fixed(f.fit.lnkw, 2)), h("td", {}, fixed(f.fit.S, 2)), h("td", {}, String(f.fit.n)), h("td", {}, fixed(f.fit.rmse, 3)), h("td", { class: "l" }, f.obs.map((o) => `run ${o.runId}: ${fixed(o.tR, 2)}`).join("; "))));

  // Prediction for the method currently in the editor, and the matching real run if one exists.
  const pred = predictFor(fits, app.fitPlates, m.program, t0, tD, m.runTimeMin);
  const actual = [...runs].reverse().find((r) => methodKey(r.method) === methodKey(m) && !app.fitRuns.has(r.id));
  const actualEx = actual ? app.lab.execute(actual) : undefined;
  const predRows = pred.map((b, i) => {
    const obs = actualEx ? app.lab.peakOf(actualEx, b.soluteId) : undefined;
    return h("tr", {}, h("th", { scope: "row" }, app.soluteName(b.soluteId)), h("td", {}, fixed(b.tR, 2)), h("td", {}, fixed(2.355 * b.sigma, 3)), h("td", {}, i === 0 ? "" : fixed(resolutionOf(pred[i - 1]!, b), 2)), h("td", {}, obs ? fixed(obs.tR, 2) : ""), h("td", {}, obs ? fixed(b.tR - obs.tR, 2) : ""));
  });
  const missing = fits.length - pred.length;
  const crit = criticalRs(pred);

  // Survey map: critical resolution over gradient time and starting % B.
  const mp = app.map;
  const nx = 10;
  const ny = 7;
  const cells: HTMLElement[] = [];
  let best: { rs: number; tg: number; phi: number; last: number } | null = null;
  if (fits.length >= 2) {
    cells.push(h("div", { class: "axis" }, "% B \\ tG"));
    for (let ix = 0; ix < nx; ix++) cells.push(h("div", { class: "axis" }, fixed(mp.tgMin + ((mp.tgMax - mp.tgMin) * ix) / (nx - 1), 0)));
    for (let iy = 0; iy < ny; iy++) {
      const phi0 = mp.phiMin + ((mp.phiMax - mp.phiMin) * iy) / (ny - 1);
      cells.push(h("div", { class: "axis" }, fixed(phi0 * 100, 0)));
      for (let ix = 0; ix < nx; ix++) {
        const tg = mp.tgMin + ((mp.tgMax - mp.tgMin) * ix) / (nx - 1);
        const program = [{ t: 0, phi: phi0 }, { t: tg, phi: mp.phiEnd }];
        const bands = predictFor(fits, app.fitPlates, program, t0, tD, tg + tD + 3 * t0, 60);
        const rs = bands.length === fits.length ? criticalRs(bands) : NaN;
        const last = bands[bands.length - 1]?.tR ?? NaN;
        if (Number.isFinite(rs) && (!best || rs > best.rs + 0.05 || (Math.abs(rs - best.rs) <= 0.05 && last < best.last))) best = { rs, tg, phi: phi0, last };
        const band = !Number.isFinite(rs) ? "late" : rs >= 2 ? "good" : rs >= 1.5 ? "fair" : "poor";
        const b = h("button", { type: "button", class: `cell ${band}`, onClick: () => { app.method.program = program; app.method.runTimeMin = Math.ceil(tg + tD + 3 * t0); app.refresh(); } }, Number.isFinite(rs) ? fixed(Math.min(rs, 99), 1) : "late");
        b.id = `map-${iy}-${ix}`;
        b.setAttribute("aria-label", `Start ${fixed(phi0 * 100, 0)} percent B, gradient time ${fixed(tg, 0)} min: predicted critical resolution ${Number.isFinite(rs) ? fixed(rs, 1) : "not all eluted"}. Load into the method editor.`);
        cells.push(b);
      }
    }
  }
  const mapInputs = h(
    "div",
    { class: "cols" },
    field("Gradient time from, min", numberInput(mp.tgMin, { min: 1, step: 1, onChange: (v) => { mp.tgMin = Math.max(1, v); app.refresh(); } })),
    field("Gradient time to, min", numberInput(mp.tgMax, { min: 2, step: 1, onChange: (v) => { mp.tgMax = Math.max(mp.tgMin + 1, v); app.refresh(); } })),
    field("Start % B from", numberInput(mp.phiMin * 100, { min: 0, max: 100, step: 5, onChange: (v) => { mp.phiMin = Math.min(0.95, Math.max(0, v / 100)); app.refresh(); } })),
    field("Start % B to", numberInput(mp.phiMax * 100, { min: 0, max: 100, step: 5, onChange: (v) => { mp.phiMax = Math.min(0.98, Math.max(mp.phiMin + 0.01, v / 100)); app.refresh(); } })),
    field("End % B", numberInput(mp.phiEnd * 100, { min: 0, max: 100, step: 5, onChange: (v) => { mp.phiEnd = Math.min(1, Math.max(0.05, v / 100)); app.refresh(); } })),
  );

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h(
      "section",
      { class: "panel" },
      h("h1", {}, "Fit and predict"),
      h("p", { class: "lede" }, "Two runs that differ in gradient steepness are enough to fit ln k = ln kw - S x (fraction of B) for each named peak. The model then predicts any other gradient or isocratic method under the same column, solvent, pH and temperature. Check the prediction with a real injection."),
      h("p", { class: "note" }, "A limit of this simulator: its own retention model is log-linear, like the one you are fitting. So your prediction errors here come from the column volume you enter, the dwell volume, and how well you read the apex. On an instrument, retention curves away from a straight line over a wide range of % B, and a two-run model predicts less well far from the conditions it was fitted at."),
      h("h2", {}, "1. Runs to fit"),
      h("div", { class: "scroll", style: "max-height:260px;overflow-y:auto" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Run"), h("th", { scope: "col" }, "Use"), h("th", { scope: "col", class: "l" }, "Sample"), h("th", { scope: "col", class: "l" }, "Method"), h("th", { scope: "col" }, "Named peaks"))), h("tbody", {}, runRows))),
      h(
        "div",
        { class: "cols", style: "margin-top:10px" },
        field("Column volume, mL", numberInput(Number(vm.toFixed(3)), { min: 0.01, step: 0.01, onChange: (v) => { app.fitT0 = Math.max(0.01, v); app.refresh(); } }), `Estimate from dimensions: ${fixed(estimatedColumnVolumeMl(col), 2)} mL. Better: retention time of an unretained marker x flow.`),
        field("Plate number to assume", numberInput(app.fitPlates, { min: 500, step: 500, onChange: (v) => { app.fitPlates = Math.max(500, v); app.refresh(); } }), "Read it from an isocratic run of yours."),
        h("p", { class: "muted" }, `Dwell volume of this instrument: ${app.lab.instrument.dwellMl} mL.`),
      ),
      problems.map((p) => h("p", { class: "note warn" }, p)),
      fits.length ? h("div", { class: "scroll" }, h("table", {}, h("caption", {}, "Fitted model"), h("thead", {}, h("tr", {}, ["Peak", "ln kw", "S", "Runs", "RMSE, min", "Observed tR, min"].map((x, i) => h("th", { scope: "col", class: i === 5 ? "l" : "" }, x)))), h("tbody", {}, fitRows))) : null,
      fits.some((f) => f.fit.n === 2) ? h("p", { class: "muted" }, "With two runs the fit passes through both points exactly, so its error says nothing yet. A third run, or the check below, tests the model.") : null,
    ),
    fits.length
      ? h(
          "section",
          { class: "panel" },
          h("h2", {}, "2. Prediction for the method in the editor"),
          h("p", { class: "muted" }, methodSummary(app, m)),
          h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["Peak", "Predicted tR, min", "Predicted W half, min", "Rs to previous", actualEx ? `Observed tR, run ${actual!.id}` : "Observed tR", "Error, min"].map((x) => h("th", { scope: "col" }, x)))), h("tbody", {}, predRows))),
          h("p", {}, pred.length >= 2 ? `Predicted critical resolution ${fixed(crit, 2)}. ` : "", missing > 0 ? `${missing} fitted peak(s) would not elute within the run time. ` : "", actualEx ? "" : "Inject this method to compare prediction with observation."),
          h("div", { class: "row" }, h("button", { type: "button", onClick: () => app.go("instrument") }, "Go to the instrument")),
        )
      : null,
    fits.length >= 2
      ? h(
          "section",
          { class: "panel" },
          h("h2", {}, "3. Survey: critical resolution over gradient time and starting % B"),
          h("p", { class: "muted" }, "Each cell is the smallest predicted resolution between neighbouring fitted peaks for a single linear gradient at the flow in the editor. Cells show the number; 2.0 and above, 1.5 to 2.0, and below 1.5 are also shaded differently. Choosing a cell loads that gradient into the editor."),
          mapInputs,
          h("div", { class: "scroll", style: "margin-top:10px" }, h("div", { class: "heat", style: `grid-template-columns:70px repeat(${nx}, minmax(44px, 1fr));min-width:${70 + nx * 46}px`, role: "group", "aria-label": "Critical resolution map" }, cells)),
          best ? h("p", { style: "margin-top:8px" }, `Best cell: start ${fixed(best.phi * 100, 0)}% B, gradient time ${fixed(best.tg, 0)} min, predicted critical resolution ${fixed(best.rs, 2)}, last peak at ${fixed(best.last, 1)} min. Only peaks you named and fitted are counted: an unnamed peak can still co-elute.`) : h("p", { class: "note warn" }, "No cell elutes every fitted peak. Widen the ranges."),
        )
      : null,
  );
}
