import { maxPressure, methodFaults } from "../../engine/simulate.ts";
import type { Method } from "../../engine/types.ts";
import { peakPurity, PURITY_LIMIT, SPECTRUM_GRID } from "../../lab/analysis.ts";
import { describeSpec } from "../../lab/samples.ts";
import type { Executed } from "../../lab/session.ts";
import type { StressAgent } from "../../lab/types.ts";
import type { App } from "../app.ts";
import { Chart, type Series } from "../chart.ts";
import { field, fixed, h, numberInput, select, sig } from "../dom.ts";

export function methodSummary(app: App, m: Method): string {
  const col = app.catalog.columns.get(m.columnId);
  const prog = m.program.length === 1 || m.program.every((p) => p.phi === m.program[0]!.phi) ? `${Math.round(m.program[0]!.phi * 100)}% B isocratic` : m.program.map((p) => `${Math.round(p.phi * 1000) / 10}% at ${p.t}`).join(", ");
  const det = m.detector.kind === "uv" ? `UV ${m.detector.nm} nm` : `MS ${m.detector.polarity === "pos" ? "positive" : "negative"} ion m/z ${m.detector.mz}`;
  return `${col?.name ?? m.columnId}; ${m.modifier === "MeCN" ? "acetonitrile" : "methanol"}; pH ${m.pH}; ${m.tempC} °C; ${m.flowMlMin} mL/min; ${prog}; ${m.injUl} µL; ${det}`;
}

/** The textbook estimate a chromatographer makes from the tube dimensions (about two thirds of the empty volume). */
export function estimatedColumnVolumeMl(col: { lengthMm: number; idMm: number }): number {
  return 0.65 * Math.PI * (col.idMm / 20) ** 2 * (col.lengthMm / 10);
}

function methodPanel(app: App): HTMLElement {
  const m = app.method;
  const c = app.lab.case;
  const col = app.lab.column(m.columnId);
  const columns = c.columns.map((id) => {
    const k = app.lab.column(id);
    return { value: id, label: `${k.name}, ${k.lengthMm} x ${k.idMm} mm, ${k.particleUm} um` };
  });

  const rows = m.program.map((p, i) =>
    h(
      "tr",
      {},
      h("th", { scope: "row" }, String(i + 1)),
      h("td", {}, (() => { const el = numberInput(p.t, { min: 0, max: 240, step: 0.1, onChange: (v) => { p.t = v; app.refresh(); } }); el.setAttribute("aria-label", `Step ${i + 1} time, min`); el.id = `prog-t-${i}`; return el; })()),
      h("td", {}, (() => { const el = numberInput(Math.round(p.phi * 1000) / 10, { min: 0, max: 100, step: 0.5, onChange: (v) => { p.phi = Math.min(100, Math.max(0, v)) / 100; app.refresh(); } }); el.setAttribute("aria-label", `Step ${i + 1} percent B`); el.id = `prog-b-${i}`; return el; })()),
      h("td", {}, m.program.length > 1 ? h("button", { type: "button", class: "small", "aria-label": `Remove step ${i + 1}`, onClick: () => { m.program.splice(i, 1); app.refresh(); } }, "Remove") : null),
    ),
  );

  const det = m.detector;
  const faults = methodFaults(m, app.lab.instrument, col);
  const p = faults.length === 0 || faults.every((f) => f.startsWith("Pressure")) ? maxPressure(m, col) : NaN;
  const limit = Math.min(app.lab.instrument.pMaxBar, col.pMaxBar);

  return h(
    "section",
    { class: "panel" },
    h("h2", {}, "Method"),
    h(
      "div",
      { class: "cols" },
      field("Column", select(m.columnId, columns, (v) => { m.columnId = v; app.refresh(); })),
      field("Solvent B", select(m.modifier, c.modifiers.map((x) => ({ value: x, label: x === "MeCN" ? "Acetonitrile" : "Methanol" })), (v) => { m.modifier = v; app.refresh(); })),
      field("Solvent A pH", numberInput(m.pH, { min: c.pH.min, max: c.pH.max, step: c.pH.step, onChange: (v) => { m.pH = Math.min(c.pH.max, Math.max(c.pH.min, v)); app.refresh(); } }), c.pH.note),
      field("Column temperature, °C", numberInput(m.tempC, { min: 5, max: 100, step: 1, onChange: (v) => { m.tempC = v; app.refresh(); } })),
      field("Flow, mL/min", numberInput(m.flowMlMin, { min: 0.01, max: 10, step: 0.05, onChange: (v) => { m.flowMlMin = v; app.refresh(); } })),
      field("Injection, µL", numberInput(m.injUl, { min: 0.1, max: 100, step: 0.5, onChange: (v) => { m.injUl = v; app.refresh(); } })),
      field("Run time, min", numberInput(m.runTimeMin, { min: 0.5, max: 240, step: 0.5, onChange: (v) => { m.runTimeMin = v; app.refresh(); } })),
    ),
    h("h3", {}, "Gradient table"),
    h("p", { class: "muted" }, "Time at the pump, and % B at that time. One row means isocratic. The last value holds to the end of the run."),
    h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Step"), h("th", { scope: "col" }, "Time, min"), h("th", { scope: "col" }, "% B"), h("th", { scope: "col" }, h("span", { class: "sr" }, "Remove")))), h("tbody", {}, rows))),
    h(
      "div",
      { class: "row", style: "margin-top:6px" },
      h("button", { type: "button", class: "small", disabled: m.program.length >= 40, onClick: () => { const last = m.program[m.program.length - 1]!; m.program.push({ t: Math.min(240, last.t + 5), phi: last.phi }); app.refresh(); } }, "Add step"),
      h("button", { type: "button", class: "small", onClick: () => { m.program.sort((a, b) => a.t - b.t); app.refresh(); } }, "Sort by time"),
    ),
    h("h3", {}, "Detector"),
    h(
      "div",
      { class: "cols" },
      field(
        "Type",
        select(det.kind, [{ value: "uv", label: "UV diode array" }, { value: "ms", label: "Single quadrupole MS" }], (v) => {
          m.detector = v === "uv" ? { kind: "uv", nm: 280, rateHz: det.rateHz } : { kind: "ms", mz: 300, polarity: "pos", rateHz: Math.min(det.rateHz, 5) };
          app.refresh();
        }),
      ),
      det.kind === "uv" ? field("Wavelength, nm", numberInput(det.nm, { min: 200, max: 400, step: 1, onChange: (v) => { det.nm = Math.min(400, Math.max(200, v)); app.refresh(); } })) : null,
      det.kind === "ms" ? field("Selected ion, m/z", numberInput(det.mz, { min: 50, max: 1500, step: 0.1, onChange: (v) => { det.mz = v; app.refresh(); } }), "Window is plus or minus 0.5.") : null,
      det.kind === "ms" ? field("Polarity", select(det.polarity, [{ value: "pos", label: "Positive, [M+H]+" }, { value: "neg", label: "Negative, [M-H]-" }], (v) => { det.polarity = v; app.refresh(); })) : null,
      field("Data rate, Hz", select(String(det.rateHz), ["1", "2", "5", "10", "20", "40"].map((x) => ({ value: x, label: x })), (v) => { det.rateHz = Number(v); app.refresh(); })),
    ),
    h(
      "p",
      { class: faults.length ? "note bad" : "note", style: "margin-top:10px" },
      faults.length ? faults.join(" ") : `Pump pressure about ${fixed(p, 0)} bar of ${limit} bar. Column volume about ${fixed(estimatedColumnVolumeMl(col), 2)} mL by the usual estimate from its dimensions; inject an unretained marker to measure it.`,
    ),
    h("div", { class: "row" }, h("button", { type: "button", class: "small", onClick: () => { app.method = structuredClone(c.defaultMethod); app.refresh(); } }, "Reset to starting method")),
  );
}

function samplePanel(app: App): HTMLElement {
  const d = app.sample;
  const c = app.lab.case;
  const standards = [...c.analytes, ...c.extraStandards];
  const kinds = [
    { value: "standard" as const, label: "Reference standard" },
    { value: "unknown" as const, label: "Sample (the product)" },
    { value: "blank" as const, label: "Blank" },
  ];
  const concTable = (target: Record<string, number>, ids: string[], caption: string): HTMLElement =>
    h(
      "div",
      { class: "scroll" },
      h(
        "table",
        {},
        h("caption", {}, caption),
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Compound"), h("th", { scope: "col" }, "µg/mL"))),
        h(
          "tbody",
          {},
          ids.map((id) => {
            const el = numberInput(target[id] ?? 0, { min: 0, step: 1, onChange: (v) => { target[id] = Math.max(0, v); app.refresh(); } });
            el.setAttribute("aria-label", `${app.soluteName(id)} concentration, µg/mL`);
            el.id = `${caption.slice(0, 3)}-${id}`;
            return h("tr", {}, h("th", { scope: "row" }, app.catalog.solutes.get(id)?.name ?? id), h("td", {}, el));
          }),
        ),
      ),
    );

  const body: Array<HTMLElement | null> = [];
  if (d.kind === "standard") {
    const all = numberInput(NaN, { min: 0, step: 1, onChange: (v) => { for (const id of standards) if ((d.levels[id] ?? 0) > 0 || c.analytes.includes(id)) d.levels[id] = Math.max(0, v); app.refresh(); } });
    all.placeholder = "value";
    body.push(
      concTable(d.levels, standards, "Standard solution"),
      h("div", { class: "cols", style: "margin-top:8px" }, field("Set every listed analyte to, µg/mL", all, "Zero leaves a compound out."), field("Preparation number", numberInput(d.prep, { min: 1, step: 1, onChange: (v) => { d.prep = Math.max(1, Math.round(v)); app.refresh(); } }), "A new number is a fresh weighing.")),
    );
  } else if (d.kind === "unknown") {
    body.push(
      h(
        "div",
        { class: "cols" },
        field("Preparation number", numberInput(d.prep, { min: 1, step: 1, onChange: (v) => { d.prep = Math.max(1, Math.round(v)); app.refresh(); } }), "A new number is a fresh weighing."),
        field("Sample weighed, mg", numberInput(d.mg, { min: 1, step: 1, onChange: (v) => { d.mg = Math.max(1, v); app.refresh(); } })),
        field("Extract volume, mL", numberInput(d.ml, { min: 1, step: 1, onChange: (v) => { d.ml = Math.max(1, v); app.refresh(); } })),
        field("Further dilution, 1 to", numberInput(d.dilution, { min: 1, step: 1, onChange: (v) => { d.dilution = Math.max(1, v); app.refresh(); } })),
      ),
      h("details", { style: "margin-top:8px", open: Object.values(d.spike).some((v) => v > 0) }, h("summary", {}, "Spike with reference material (for recovery)"), concTable(d.spike, c.analytes, "Added before extraction, as µg/mL in the vial")),
    );
  }
  if (d.kind !== "blank") {
    const agents: Array<{ value: StressAgent; label: string }> = [
      { value: "heat", label: "Heat" },
      { value: "acid", label: "Acid, 0.1 M HCl" },
      { value: "base", label: "Base, 0.1 M NaOH" },
      { value: "peroxide", label: "Oxidation, 3% H2O2" },
      { value: "light", label: "Light" },
    ];
    const on = h("input", { type: "checkbox", checked: d.stressOn });
    on.addEventListener("change", () => { d.stressOn = on.checked; app.refresh(); });
    body.push(
      h(
        "details",
        { style: "margin-top:8px", open: d.stressOn },
        h("summary", {}, "Stress the solution first (forced degradation)"),
        h("div", { class: "check" }, on, h("label", { for: (on.id = "stress-on") }, "Apply stress before injecting")),
        h(
          "div",
          { class: "cols" },
          field("Condition", select(d.stress.agent, agents, (v) => { d.stress.agent = v; app.refresh(); })),
          field("Time, h", numberInput(d.stress.hours, { min: 0, max: 720, step: 0.5, onChange: (v) => { d.stress.hours = v; app.refresh(); } })),
          field("Temperature, °C", numberInput(d.stress.tempC, { min: 4, max: 150, step: 1, onChange: (v) => { d.stress.tempC = v; app.refresh(); } })),
        ),
      ),
    );
  }

  return h(
    "section",
    { class: "panel" },
    h("h2", {}, "Sample"),
    h(
      "div",
      { class: "cols" },
      field("What to inject", select(d.kind, kinds, (v) => { d.kind = v; app.refresh(); })),
      field("Diluent, % organic", numberInput(d.diluentPct, { min: 0, max: 100, step: 5, onChange: (v) => { d.diluentPct = Math.min(100, Math.max(0, v)); app.refresh(); } })),
      field("Replicate injections", numberInput(d.replicates, { min: 1, max: 10, step: 1, onChange: (v) => { d.replicates = Math.min(10, Math.max(1, Math.round(v))); app.refresh(); } })),
    ),
    h("div", { style: "margin-top:8px" }, body),
    h("p", { class: "muted", style: "margin-top:8px" }, describeSpec(app.specFromDraft(), app.catalog.solutes)),
    h("div", { class: "row" }, h("button", { type: "button", class: "primary", id: "inject", onClick: () => { app.inject(); app.refresh(); } }, d.replicates > 1 ? `Inject ${d.replicates} times` : "Inject")),
    app.message ? h("p", { class: `note ${app.message.kind === "bad" ? "bad" : ""}`, style: "margin-top:8px" }, app.message.text) : null,
  );
}

function labelOptions(app: App): Array<{ value: string; label: string }> {
  const c = app.lab.case;
  return [
    { value: "", label: "not named" },
    ...[...c.analytes, ...c.extraStandards].map((id) => ({ value: id, label: app.soluteName(id) })),
    ...["a", "b", "c", "d", "e"].map((x) => ({ value: `unk${x}`, label: `Unknown ${x.toUpperCase()}` })),
  ];
}

function resultPanel(app: App): HTMLElement {
  const runs = app.lab.session.runs;
  if (runs.length === 0) return h("section", { class: "panel" }, h("h2", {}, "Chromatogram"), h("p", { class: "muted" }, "No injections yet. Set a method and a sample, then inject."));
  const ex = app.lab.run(app.selectedRun ?? runs[runs.length - 1]!.id) ?? app.lab.execute(runs[runs.length - 1]!);
  const over = app.overlayRun !== null && app.overlayRun !== ex.record.id ? app.lab.run(app.overlayRun) : undefined;
  const { result, integration } = ex;
  const unit = result.unit;
  const chart = new Chart(320);
  const series: Series[] = [{ label: `Run ${ex.record.id}`, x: result.time, y: result.signal }];
  if (over) series.push({ label: `Run ${over.record.id}`, x: over.result.time, y: over.result.signal });
  chart.set({
    series: [...series, { label: "baseline", x: result.time, y: integration.baseline, muted: true }],
    xLabel: "Time, min",
    yLabel: `Response, ${unit}`,
    markers: integration.peaks.map((p) => ({ x: p.tR, y: p.height + p.baseline, text: ex.names.has(p.n) ? `${p.n} ${app.soluteName(ex.names.get(p.n)!)}` : String(p.n) })),
    drops: integration.peaks.flatMap((p) => (p.endKind === "valley" ? [{ x: p.tEnd, y0: integration.baseline[Math.round(p.tEnd / (result.time[1]! - result.time[0]!))] ?? 0, y1: result.signal[Math.round(p.tEnd / (result.time[1]! - result.time[0]!))] ?? 0 }] : [])),
    summary: `Chromatogram of run ${ex.record.id}: ${integration.peaks.length} integrated peaks between ${fixed(integration.peaks[0]?.tR ?? 0, 2)} and ${fixed(integration.peaks[integration.peaks.length - 1]?.tR ?? 0, 2)} min. The peak table below lists them.`,
  });

  const opts = labelOptions(app);
  const peakRows = integration.peaks.map((p) => {
    const sel = select(ex.names.get(p.n) ?? "", opts, (v) => { app.lab.label(ex.record.id, p.tR, v); app.persist(); app.refresh(); });
    sel.setAttribute("aria-label", `Name for peak ${p.n}`);
    sel.id = `name-${ex.record.id}-${p.n}`;
    const pick = h("button", { type: "button", class: "small", "aria-pressed": String(app.selectedPeak === p.n), onClick: () => { app.selectedPeak = app.selectedPeak === p.n ? null : p.n; app.refresh(); } }, String(p.n));
    pick.setAttribute("aria-label", `Show spectrum for peak ${p.n}`);
    pick.id = `pick-${ex.record.id}-${p.n}`;
    return h(
      "tr",
      { class: app.selectedPeak === p.n ? "selected" : "" },
      h("th", { scope: "row" }, pick),
      h("td", { class: "l" }, sel),
      h("td", {}, fixed(p.tR, 3)),
      h("td", {}, sig(p.area, 4)),
      h("td", {}, sig(p.height, 4)),
      h("td", {}, fixed(p.areaPct, 1)),
      h("td", {}, fixed(p.wHalf, 3)),
      h("td", {}, fixed(p.resolution, 2)),
      h("td", {}, fixed(p.symmetry, 2)),
      h("td", {}, Number.isFinite(p.plates) ? String(Math.round(p.plates)) : "n/a"),
      h("td", {}, sig(p.sn, 3)),
      h("td", { class: "l" }, p.truncated ? h("span", { class: "fail" }, "cut off by the run") : p.startKind === "valley" || p.endKind === "valley" ? "valley" : "baseline"),
    );
  });

  const runRows = [...runs].reverse().map((r) => {
    const view = h("button", { type: "button", class: "small", "aria-pressed": String(r.id === ex.record.id), onClick: () => { app.selectedRun = r.id; app.selectedPeak = null; app.refresh(); } }, "View");
    view.id = `view-${r.id}`;
    view.setAttribute("aria-label", `View run ${r.id}`);
    const ov = h("button", { type: "button", class: "small", "aria-pressed": String(r.id === app.overlayRun), onClick: () => { app.overlayRun = app.overlayRun === r.id ? null : r.id; app.refresh(); } }, "Overlay");
    ov.id = `overlay-${r.id}`;
    ov.setAttribute("aria-label", `Overlay run ${r.id}`);
    const load = h("button", { type: "button", class: "small", onClick: () => { app.method = structuredClone(r.method); app.refresh(); } }, "Load method");
    load.id = `load-${r.id}`;
    load.setAttribute("aria-label", `Load method of run ${r.id}`);
    return h("tr", { class: r.id === ex.record.id ? "selected" : "" }, h("th", { scope: "row" }, String(r.id)), h("td", { class: "l wrap" }, describeSpec(r.spec, app.catalog.solutes)), h("td", { class: "l wrap" }, methodSummary(app, r.method)), h("td", {}, h("div", { class: "row", style: "flex-wrap:nowrap;justify-content:flex-end" }, view, ov, load)));
  });

  const integ = app.analysis.integration;
  const minSn = numberInput(integ.minSignalToNoise, { min: 2, max: 1000, step: 1, onChange: (v) => { integ.minSignalToNoise = v; app.analysisChanged(true); } });
  const from = numberInput(integ.tStart, { min: 0, max: 240, step: 0.1, onChange: (v) => { integ.tStart = v; app.analysisChanged(true); } });

  return h(
    "section",
    { class: "panel" },
    h("h2", {}, `Chromatogram, run ${ex.record.id}`),
    h("p", { class: "muted" }, `${describeSpec(ex.record.spec, app.catalog.solutes)}. ${methodSummary(app, ex.record.method)}.`),
    result.warnings.length ? h("p", { class: "note warn" }, result.warnings.join(" ")) : null,
    chart.el,
    over ? h("div", { class: "legend" }, h("span", {}, h("i", { style: "border-color:var(--series-1)" }), `Run ${ex.record.id} (solid)`), h("span", {}, h("i", { style: "border-color:var(--series-2);border-top-style:dashed" }), `Run ${over.record.id} (dashed)`)) : null,
    h("div", { class: "cols", style: "margin:10px 0" }, field("Ignore peaks below S/N", minSn), field("Integrate from, min", from, "Zero skips only the solvent front."), h("p", { class: "muted" }, `Noise ${sig(integration.noiseSd, 2)} ${unit} (sd). Pressure ${fixed(result.pressureBarMax, 0)} bar.`)),
    h(
      "div",
      { class: "scroll" },
      h(
        "table",
        {},
        h("caption", {}, "Integrated peaks"),
        h("thead", {}, h("tr", {}, ["Peak", "Name", "tR, min", "Area", "Height", "Area %", "W half, min", "Rs", "Symmetry", "Plates", "S/N", "Bounds"].map((x, i) => h("th", { scope: "col", class: i === 1 || i === 11 ? "l" : "" }, x)))),
        h("tbody", {}, peakRows.length ? peakRows : h("tr", {}, h("td", { class: "l", colspan: 12 }, "No peaks above the threshold."))),
      ),
    ),
    h("p", { class: "muted" }, "Rs is resolution from the previous peak. Heights and widths are measured on the recorded signal. In a gradient run the plate number is an apparent value and does not describe the column. Name a peak once and the name is carried to the nearest peak at that retention time in every run of the same method."),
    spectrumPanel(app, ex),
    h("h3", {}, "Notebook"),
    h("div", { class: "scroll", style: "max-height:320px;overflow-y:auto" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Run"), h("th", { scope: "col", class: "l" }, "Sample"), h("th", { scope: "col", class: "l" }, "Method"), h("th", { scope: "col" }, h("span", { class: "sr" }, "Actions")))), h("tbody", {}, runRows))),
  );
}

function spectrumPanel(app: App, ex: Executed): HTMLElement | null {
  const peak = ex.integration.peaks.find((p) => p.n === app.selectedPeak);
  if (!peak) return h("p", { class: "muted" }, "Select a peak number to see its UV spectrum and a purity check.");
  if (ex.record.method.detector.kind !== "uv") return h("p", { class: "note" }, "Spectra are recorded only with the diode array detector.");
  const pur = peakPurity(app.lab, ex, peak);
  const norm = (s: number[]): number[] => {
    const m = Math.max(...s, 1e-12);
    return s.map((v) => v / m);
  };
  const chart = new Chart(220);
  const names = ["Front", "Apex", "Tail"];
  chart.set({
    series: [pur.spectra[0]!, pur.spectra[2]!, pur.spectra[4]!].map((s, i) => ({ label: names[i]!, x: SPECTRUM_GRID as number[], y: norm(s) })),
    xLabel: "Wavelength, nm",
    yLabel: "Normalised absorbance",
    yFloorZero: true,
    summary: `UV spectra at the front, apex and tail of peak ${peak.n} at ${fixed(peak.tR, 2)} min.`,
  });
  const apex = pur.spectra[2]!;
  const maxI = apex.indexOf(Math.max(...apex));
  return h(
    "div",
    {},
    h("h3", {}, `Peak ${peak.n}: UV spectrum and purity`),
    chart.el,
    h("div", { class: "legend" }, h("span", {}, h("i", { style: "border-color:var(--series-1)" }), "Front (solid)"), h("span", {}, h("i", { style: "border-color:var(--series-2);border-top-style:dashed" }), "Apex (dashed)"), h("span", {}, h("i", { style: "border-color:var(--series-3);border-top-style:dotted" }), "Tail (dotted)")),
    h(
      "p",
      {},
      `Absorbance maximum near ${SPECTRUM_GRID[maxI]} nm. `,
      Number.isNaN(pur.match)
        ? "The peak is too small for a purity check: its spectra on the flanks are lost in detector noise."
        : [
            `Lowest spectral match between the apex and ${pur.used} point(s) on the flanks: ${fixed(pur.match, 1)} of 1000. `,
            pur.match < PURITY_LIMIT ? h("span", { class: "fail" }, "The spectrum changes across the peak, which points to more than one compound.") : h("span", {}, "No spectral change found across the peak. That does not prove one compound: an impurity with a similar spectrum, or one that elutes exactly under the apex, would not show."),
          ],
    ),
  );
}

export function instrumentView(app: App): HTMLElement {
  return h("div", { style: "display:grid;gap:16px" }, h("h1", { class: "sr" }, "Instrument"), h("div", { class: "grid2" }, methodPanel(app), samplePanel(app)), resultPanel(app));
}
