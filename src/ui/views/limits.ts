// Model and limits: what the simulator computes, where every parameter comes from,
// how it compares with the literature, and the debrief.

import { checks, literature, references, type LiteratureMethod } from "../../data/index.ts";
import { fitLss } from "../../engine/fit.ts";
import { computeBands } from "../../engine/simulate.ts";
import type { Basis, Provenance } from "../../engine/types.ts";
import { contentAsReceived, truthFor } from "../../lab/samples.ts";
import type { App } from "../app.ts";
import { fixed, h, sig } from "../dom.ts";
import { estimatedColumnVolumeMl } from "./instrument.ts";

const BASIS: Record<Basis, string> = {
  reported: "Reported: a number printed in the source.",
  digitized: "Digitized: read from a published figure.",
  fitted: "Fitted: computed for this project from reported numbers.",
  assumed: "Assumed: a typical value, with no measurement behind it.",
};

function simulateLiterature(app: App, l: LiteratureMethod): Array<{ soluteId: string; published: number; model: number; heldOut?: number }> {
  const column = app.catalog.columns.get(l.method.columnId);
  const base = [...app.catalog.instruments.values()][0];
  if (!column || !base) return [];
  const bands = computeBands({
    method: l.method,
    instrument: { ...base, dwellMl: l.dwellMl, extraColVarUl2: 0, pMaxBar: 5000 },
    column: { ...column, pMaxBar: 5000 },
    sample: { id: l.id, label: l.id, diluentPhi: l.method.program[0]?.phi ?? 0.1, components: l.reported.map((r) => ({ soluteId: r.soluteId, ugPerMl: 10 })) },
    solutes: app.catalog.solutes,
    seed: l.id,
  });
  return l.reported.map((r) => {
    const held = l.heldOut?.find((x) => x.soluteId === r.soluteId)?.tR;
    return { soluteId: r.soluteId, published: r.tR, model: bands.find((b) => b.soluteId === r.soluteId)?.tR ?? NaN, ...(held === undefined ? {} : { heldOut: held }) };
  });
}

function provCell(p: Provenance): HTMLElement {
  return h("td", { class: "l", style: "white-space:normal;min-width:220px" }, h("strong", {}, p.basis), `. ${references[p.ref]?.citation.split(".")[0] ?? p.ref}${p.locus ? `, ${p.locus}` : ""}. ${p.note ?? ""}`);
}

function debrief(app: App): HTMLElement {
  const s = app.lab.session;
  const c = app.lab.case;
  if (s.debriefAt === null) {
    return h(
      "section",
      { class: "panel" },
      h("h2", {}, "Debrief"),
      h("p", {}, "The debrief shows what was really in your sample, which compound each peak was, and the true retention parameters beside your fitted ones. Opening it is recorded in your notebook and printed on your report."),
      h("button", { type: "button", id: "open-debrief", onClick: () => { s.debriefAt = s.runs.length; app.persist(); app.refresh(); } }, "Open the debrief"),
    );
  }
  const truth = truthFor(c, s.seed);
  const received = contentAsReceived(c, s.seed, app.catalog.solutes);
  const run = app.selectedRun !== null ? app.lab.run(app.selectedRun) : undefined;
  const blocks: HTMLElement[] = [
    h("h2", {}, "Debrief"),
    h("p", {}, `Opened after ${s.debriefAt} injection(s). Situation for code ${s.seed}: ${truth.variant.label}`),
    h("p", {}, `True extraction recovery: ${(100 * truth.recovery).toFixed(1)}%. A result that is not corrected for recovery should read that fraction of the content below.`),
    h(
      "div",
      { class: "scroll" },
      h(
        "table",
        {},
        h("caption", {}, "True content of the lot as it reached you, mg/g"),
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Compound"), h("th", { scope: "col" }, "As received"), h("th", { scope: "col" }, "As made"))),
        h("tbody", {}, Object.entries(received).filter(([, v]) => v > 1e-6).map(([id, v]) => h("tr", {}, h("th", { scope: "row" }, app.catalog.solutes.get(id)?.name ?? id), h("td", {}, sig(v, 4)), h("td", {}, sig(truth.mgPerG[id] ?? 0, 4))))),
      ),
    ),
  ];
  if (run) {
    const eluted = run.result.peaks.filter((p) => p.eluted && p.area > 0).sort((a, b) => a.tR - b.tR);
    blocks.push(
      h("h3", {}, `What eluted in run ${run.record.id}`),
      h(
        "div",
        { class: "scroll" },
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, ["Compound", "True tR, min", "k at elution", "Your name for the nearest integrated peak"].map((x, i) => h("th", { scope: "col", class: i === 3 ? "l" : "" }, x)))),
          h("tbody", {}, eluted.map((p) => {
            const near = [...run.integration.peaks].sort((a, b) => Math.abs(a.tR - p.tR) - Math.abs(b.tR - p.tR))[0];
            const named = near && Math.abs(near.tR - p.tR) < 3 * (p.sigma + p.tau) ? run.names.get(near.n) : undefined;
            return h("tr", {}, h("th", { scope: "row" }, app.catalog.solutes.get(p.soluteId)?.name ?? p.soluteId), h("td", {}, fixed(p.tR, 3)), h("td", {}, fixed(p.kElution, 2)), h("td", { class: "l" }, named ? `${app.soluteName(named)}${named === p.soluteId ? " (correct)" : " (not this compound)"}` : near ? `peak ${near.n}, not named` : "no peak"));
          })),
        ),
      ),
    );
    // True parameters on this run's column against the student's own fit, if they made one.
    const col = app.lab.column(run.record.method.columnId);
    const vm = app.fitT0 ?? estimatedColumnVolumeMl(col);
    const rows: HTMLElement[] = [];
    for (const id of [...c.analytes]) {
      const p = app.catalog.solutes.get(id)?.retention[col.id]?.[run.record.method.modifier];
      if (!p) continue;
      const obs = app.lab.session.runs.filter((r) => app.fitRuns.has(r.id)).flatMap((r) => {
        const ex = app.lab.execute(r);
        const pk = app.lab.peakOf(ex, id);
        return pk ? [{ program: r.method.program, t0: vm / r.method.flowMlMin, tD: app.lab.instrument.dwellMl / r.method.flowMlMin, tR: pk.tR }] : [];
      });
      const f = obs.length >= 2 ? fitLss(obs) : null;
      rows.push(h("tr", {}, h("th", { scope: "row" }, app.soluteName(id)), h("td", {}, fixed(p.lnkw, 2)), h("td", {}, fixed(p.S1, 2)), h("td", {}, f ? fixed(f.lnkw, 2) : ""), h("td", {}, f ? fixed(f.S, 2) : ""), provCell(p.prov)));
    }
    blocks.push(
      h("h3", {}, `True retention parameters on ${col.name}, at ${app.catalog.solutes.get(c.analytes[0]!)?.retention[col.id]?.MeCN?.tRefC ?? 30} °C, neutral form`),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["Compound", "ln kw", "S", "Your ln kw", "Your S", "Where the true value comes from"].map((x, i) => h("th", { scope: "col", class: i === 5 ? "l" : "" }, x)))), h("tbody", {}, rows))),
      h("p", { class: "muted" }, `True column volume ${fixed(col.porosityTotal * Math.PI * (col.idMm / 20) ** 2 * (col.lengthMm / 10), 3)} mL. Your fit differs from the truth when the column volume you entered differs from this, because ln kw and S absorb the error.`),
    );
  }
  return h("section", { class: "panel" }, blocks);
}

export function limitsView(app: App): HTMLElement {
  const c = app.lab.case;
  const lit = literature.filter((l) => l.caseId === c.id);
  const litBlocks = lit.map((l) => {
    const rows = simulateLiterature(app, l).sort((a, b) => a.published - b.published);
    const err = rows.filter((r) => Number.isFinite(r.model)).map((r) => Math.abs(r.model / r.published - 1));
    const hasHeld = rows.some((r) => r.heldOut !== undefined);
    return h(
      "details",
      {},
      h("summary", {}, `${l.label} (${references[l.ref]?.citation.split(".")[0] ?? l.ref})`),
      h("p", { class: "muted" }, l.note),
      h(
        "div",
        { class: "scroll" },
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, ["Compound", "Published tR, min", "Simulator, min", "Difference, %", ...(hasHeld ? ["Predicted without this method, min"] : [])].map((x) => h("th", { scope: "col" }, x)))),
          h("tbody", {}, rows.map((r) => h("tr", {}, h("th", { scope: "row" }, app.soluteName(r.soluteId)), h("td", {}, fixed(r.published, 2)), h("td", {}, fixed(r.model, 2)), h("td", {}, fixed(100 * (r.model / r.published - 1), 1)), hasHeld ? h("td", {}, r.heldOut === undefined ? "" : fixed(r.heldOut, 2)) : null))),
        ),
      ),
      h("p", {}, `Mean absolute difference ${fixed((100 * err.reduce((s, v) => s + v, 0)) / Math.max(1, err.length), 1)}%. `, l.usedInFit ? "These retention times were used to set the parameters on this column, so agreement here is calibration, not a test. The last column is the test." : "These retention times were not used to set the compound parameters."),
    );
  });

  const ids = [...c.analytes, ...c.extraStandards];
  const provRows = ids.map((id) => {
    const s = app.catalog.solutes.get(id)!;
    const first = c.columns.map((col) => s.retention[col]?.MeCN?.prov).find((p) => p);
    const bases = [...new Set(c.columns.map((col) => s.retention[col]?.MeCN?.prov.basis).filter(Boolean))].join(", ");
    return h("tr", {}, h("th", { scope: "row" }, s.name), h("td", { class: "l", style: "white-space:normal;min-width:240px" }, first ? [h("strong", {}, bases), `. ${first.note ?? ""}`] : "none"), s.ionization ? provCell(s.ionization.prov) : h("td", { class: "l" }, "treated as neutral"), provCell(s.uvProv));
  });

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h(
      "section",
      { class: "panel" },
      h("h1", {}, "Model and limits"),
      h("p", { class: "lede" }, "This page says what the simulator computes, where each number comes from, and how far to trust it. Nothing here is hidden behind the exercise except the parameter values themselves, which the debrief reveals."),
      h("h2", {}, "What it can and cannot tell you"),
      h(
        "ul",
        {},
        h("li", {}, "It reproduces how retention, band width and response change with composition, gradient shape, temperature, pH, flow, column dimensions and instrument volume, using published models. Trends and trade-offs are reliable."),
        h("li", {}, "Absolute retention times are as good as the data behind them. For cannabinoids the retention factors and their dependence on acetonitrile are published measurements on four columns. For catechins no such measurements are openly available: parameters were fitted to retention times from seven published methods. A method left out of that fit is then predicted with an rms error of 4 to 16% in retention time after one parameter (column strength) is fitted to it, and single compounds miss by up to 31% (see the checks below)."),
        h("li", {}, "The retention model is log-linear in % B. Real retention curves over a wide range, so a model fitted from two of your own runs predicts better here than it would on an instrument."),
        h("li", {}, "Temperature changes retention, efficiency and pressure, but not selectivity: every compound in a case has the same enthalpy, because the data to tell them apart is not open. Do not draw conclusions about temperature selectivity from this tool."),
        h("li", {}, "Only acetonitrile is offered as solvent B, because no open data supports methanol for these compounds. Anion retention, extraction recovery, peak tailing and most degradation rates are assumed values. Degradation products other than the named cannabinoids and catechins are stand-ins: one peak where a real sample would give several."),
        h("li", {}, "A buffer does three things here, all of them textbook behaviour: it holds the pH of solvent A only within about one unit of its pKa (outside that, pH and so the retention of ionizable compounds wanders from run to run), it absorbs at low wavelength, and phosphate cannot go to a mass detector. The size of the pH wander and of the absorbance are assumed. The buffer does not otherwise change retention or selectivity in this tool, and ionic strength is not modelled."),
        h("li", {}, "Injection is treated as a plug focused or broadened at the column head. A large injection in a solvent much stronger than the eluent distorts and splits peaks on an instrument more than it does here; the bench warns when you are in that region."),
        h("li", {}, "Detector noise has a fast and a slow part, sized to typical instruments. The mass detector has an assumed response per compound, source variation between injections, and a simple saturation limit. It does not model adducts, in-source fragmentation or ionization chemistry, and it is not a tandem instrument."),
        h("li", {}, "The peak-purity check compares spectra at five points across a peak. It cannot see an impurity with the same chromophore, or one sitting exactly under the apex."),
        h("li", {}, "Stationary-phase ageing, pH hysteresis, buffer capacity, system peaks beyond the solvent front, carry-over and adsorption on hardware are not modelled."),
        h("li", {}, "It is a teaching instrument. It is not a substitute for commercial method-modelling software, and nothing here should be used to justify a regulated method."),
      ),
      h("h2", {}, "Equations"),
      h(
        "div",
        { class: "eq" },
        [
          "Retention            ln k = ln kw - S phi                         (linear solvent strength; Neue-Kuss form supported)",
          "Temperature          ln k(T) = ln k(Tref) - (dH/R)(1/T - 1/Tref)   (van 't Hoff)",
          "Ionization           k = k_HA (1 + r 10^(pH - pKa)) / (1 + 10^(pH - pKa)),  r = k_A / k_HA",
          "Migration            dx/dt = 1 / (t0 (1 + k(phi(t - tD - x t0))))  x = fraction of column length",
          "Band variance        dv/dt = u h + 2 v du/dx                       (plate dispersion + gradient compression)",
          "Injection plug       v0 = (Vinj / (V0 (1 + k_diluent)))^2 / 12",
          "Plate height         h = A + B/nu + C nu,  nu = u_e d_p / D_m      (reduced van Deemter)",
          "Diffusion            D_m = 7.4e-8 sqrt(psi M) T / (eta V^0.6)      (Wilke-Chang)",
          "Pressure             dP = 180 eta u L (1 - e)^2 / (e^3 d_p^2)      (Kozeny-Carman)",
          "Extra-column         sigma_t^2 = sigma_col^2 + sigma_ec^2 / F^2;  tail from detector time constant",
          "UV response          area = eps b n / F;  stray light bends the response above about 1.5 AU",
          "Peak shape           exponentially modified Gaussian",
          "Resolution           Rs = 1.18 (t2 - t1) / (w_h1 + w_h2)",
          "Plate number         N = 5.54 (tR / w_h)^2",
          "Symmetry factor      As = w_0.05 / (2 f)",
          "Signal to noise      S/N = 2 H / h",
          "Limits (ICH Q2(R2))  DL = 3.3 sigma / S,  QL = 10 sigma / S     (sigma in response units at the low end)",
        ].join("\n"),
      ),
      h("p", { class: "muted" }, "Peaks are found and integrated on the sampled trace by a routine that sees only the signal, so co-elution, tailing, drift and noise affect areas and metrics as they do on an instrument. Sources for each equation are in docs/MODEL.md in the repository."),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, `Where the parameters come from: ${c.title}`),
      h("ul", {}, Object.values(BASIS).map((b) => h("li", {}, b))),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["Compound", "Retention", "Ionization", "UV response"].map((x, i) => h("th", { scope: "col", class: i ? "l" : "" }, x)))), h("tbody", {}, provRows))),
      h("p", { class: "muted", style: "margin-top:8px" }, "Column dimensions follow the source methods. Column porosity, plate-height coefficients, instrument dwell and extra-column volumes are typical values. Degradation: decarboxylation rate constants and activation energies of the acidic cannabinoids are published (measured on dried extract, not in solution); catechin epimerization uses published activation energies with assumed rates; all other rates are assumed."),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Checks against the literature"),
      h("p", {}, "Each published method below is run in the simulator at its stated conditions."),
      litBlocks,
      h("h3", {}, "Other checks"),
      h("p", { class: "muted" }, "Each note says whether the published number was used in setting the model. Where it was, agreement is calibration and not evidence."),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["Quantity", "Published", "Simulator", "Note"].map((x, i) => h("th", { scope: "col", class: i === 3 ? "l" : "" }, x)))), h("tbody", {}, checks.filter((k) => k.caseId === c.id).map((k) => h("tr", {}, h("th", { scope: "row", style: "white-space:normal;min-width:200px" }, k.quantity), h("td", {}, k.published), h("td", { style: "white-space:normal" }, k.model), h("td", { class: "l", style: "white-space:normal;min-width:240px" }, k.note)))))),
    ),
    debrief(app),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Sources"),
      h("ul", {}, Object.values(references).map((r) => h("li", {}, r.citation, " ", h("a", { href: r.url, rel: "noopener" }, r.doi ? `doi:${r.doi}` : "link"), ". ", h("span", { class: "muted" }, r.license)))),
    ),
  );
}
