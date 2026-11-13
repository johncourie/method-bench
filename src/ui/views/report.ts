import { hashString } from "../../engine/rng.ts";
import { suitability } from "../../lab/analysis.ts";
import { describeSpec } from "../../lab/samples.ts";
import { methodKey } from "../../lab/session.ts";
import type { App } from "../app.ts";
import { Chart } from "../chart.ts";
import { fixed, h, sig } from "../dom.ts";
import { methodSummary } from "./instrument.ts";
import { calibrationFor, summarise, totalsList } from "./quant.ts";
import { quantify } from "../../lab/analysis.ts";
import { validationRows } from "./validation.ts";

/** Short fingerprint of the notebook. The same notebook file always gives the same value. */
export function fingerprint(app: App): string {
  const text = app.exportSession();
  return [hashString(text), hashString(`${text}#2`)].map((n) => n.toString(16).padStart(8, "0")).join("-").toUpperCase();
}

export function reportView(app: App): HTMLElement {
  const s = app.lab.session;
  const c = app.lab.case;
  const m = app.refMethod();
  if (!m) return h("section", { class: "panel" }, h("h1", {}, "Report"), h("p", { class: "muted" }, "Nothing to report yet."));
  const ledger = app.lab.ledger();
  const col = app.lab.column(m.columnId);
  const sampleRun = [...s.runs].reverse().find((r) => methodKey(r.method) === methodKey(m) && r.spec.kind === "unknown") ?? [...s.runs].reverse().find((r) => methodKey(r.method) === methodKey(m));
  const ex = sampleRun ? app.lab.execute(sampleRun) : undefined;

  let figure: HTMLElement | null = null;
  if (ex) {
    const chart = new Chart(260);
    chart.set({
      series: [{ label: `Run ${ex.record.id}`, x: ex.result.time, y: ex.result.signal }],
      xLabel: "Time, min",
      yLabel: `Response, ${ex.result.unit}`,
      markers: ex.integration.peaks.map((p) => ({ x: p.tR, y: p.height + p.baseline, text: ex.names.has(p.n) ? app.soluteName(ex.names.get(p.n)!) : String(p.n) })),
      summary: `Chromatogram of run ${ex.record.id} under the reference method.`,
    });
    figure = chart.el;
  }

  const results = c.analytes.map((id) => {
    const cal = calibrationFor(app, id);
    const sum = cal ? summarise(quantify(app.lab, m, cal, app.analysis.response)) : null;
    const sst = suitability(app.lab, m, id);
    const claim = c.product.claim.find((k) => k.soluteId === id);
    return h(
      "tr",
      {},
      h("th", { scope: "row" }, app.catalog.solutes.get(id)?.name ?? id),
      h("td", {}, cal?.fit ? `${cal.fit.n}` : ""),
      h("td", {}, cal?.fit ? fixed(cal.fit.r2, 4) : ""),
      h("td", {}, cal?.fit ? sig(cal.ql, 2) : ""),
      h("td", {}, sst ? fixed(sst.areaRsd, 2) : ""),
      h("td", {}, sst && Number.isFinite(sst.resolutionMin) ? fixed(sst.resolutionMin, 2) : ""),
      h("td", {}, sum ? sig(sum.mean, 4) : "not determined"),
      h("td", {}, sum && Number.isFinite(sum.rsd) ? fixed(sum.rsd, 1) : ""),
      h("td", {}, sum && claim ? fixed((100 * sum.mean) / claim.mgPerG, 1) : ""),
    );
  });

  const val = validationRows(app, app.analysis.solute);
  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h(
      "section",
      { class: "panel" },
      h("div", { class: "row", style: "justify-content:space-between" }, h("h1", {}, "Report"), h("button", { type: "button", class: "primary no-print", onClick: () => window.print() }, "Print or save as PDF")),
      h(
        "div",
        { class: "scroll" },
        h(
          "table",
          {},
          h("caption", {}, "Method report"),
          h("tbody", {}, [
            ["Analyst", s.student || "not entered"],
            ["Case", c.title],
            ["Product", c.product.name],
            ["Assignment code", s.seed],
            ["Instrument", app.lab.instrument.name],
            ["Notebook fingerprint", fingerprint(app)],
            ["Injections, instrument time, solvent", `${ledger.injections}; ${(ledger.minutes / 60).toFixed(1)} h; ${ledger.solventMl.toFixed(0)} mL`],
            ["Debrief opened", s.debriefAt === null ? "no" : `yes, after ${s.debriefAt} injection(s)`],
          ].map(([a, b]) => h("tr", {}, h("th", { scope: "row" }, a), h("td", { class: "l", style: "text-align:left;white-space:normal" }, b)))),
        ),
      ),
      h("p", { class: "muted", style: "margin-top:8px" }, "The fingerprint is computed from the notebook file, which holds every injection and every processing choice on this page. An instructor who loads the same file sees the same fingerprint and the same numbers. It is a checksum, not a seal: it shows that a report and a file belong together."),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Reference method"),
      h(
        "div",
        { class: "scroll" },
        h(
          "table",
          {},
          h("tbody", {}, [
            ["Column", `${col.name}, ${col.chemistry}, ${col.lengthMm} x ${col.idMm} mm, ${col.particleUm} um`],
            ["Mobile phase", `A: water at pH ${m.pH}. B: ${m.modifier === "MeCN" ? "acetonitrile" : "methanol"}`],
            ["Programme", m.program.map((p) => `${p.t} min ${Math.round(p.phi * 1000) / 10}% B`).join("; ")],
            ["Flow, temperature", `${m.flowMlMin} mL/min, ${m.tempC} °C`],
            ["Injection, run time", `${m.injUl} µL, ${m.runTimeMin} min`],
            ["Detection", m.detector.kind === "uv" ? `UV ${m.detector.nm} nm, ${m.detector.rateHz} Hz` : `MS ${m.detector.polarity === "pos" ? "positive" : "negative"} ion, m/z ${m.detector.mz}, ${m.detector.rateHz} Hz`],
          ].map(([a, b]) => h("tr", {}, h("th", { scope: "row" }, a), h("td", { style: "text-align:left;white-space:normal" }, b)))),
        ),
      ),
      ex ? h("p", { class: "muted", style: "margin-top:8px" }, `Run ${ex.record.id}: ${describeSpec(ex.record.spec, app.catalog.solutes)}`) : null,
      figure,
      ex
        ? h("div", { class: "scroll" }, h("table", {}, h("caption", {}, "Peak table"), h("thead", {}, h("tr", {}, ["Peak", "Name", "tR, min", "Area", "Area %", "Rs", "Symmetry", "Plates", "S/N"].map((x, i) => h("th", { scope: "col", class: i === 1 ? "l" : "" }, x)))), h("tbody", {}, ex.integration.peaks.map((p) => h("tr", {}, h("th", { scope: "row" }, String(p.n)), h("td", { class: "l" }, ex.names.has(p.n) ? app.soluteName(ex.names.get(p.n)!) : ""), h("td", {}, fixed(p.tR, 3)), h("td", {}, sig(p.area, 4)), h("td", {}, fixed(p.areaPct, 1)), h("td", {}, fixed(p.resolution, 2)), h("td", {}, fixed(p.symmetry, 2)), h("td", {}, Number.isFinite(p.plates) ? String(Math.round(p.plates)) : "n/a"), h("td", {}, sig(p.sn, 3)))))))
        : null,
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Results"),
      h("p", { class: "muted" }, `Response: peak ${app.analysis.response}. Weighting: ${app.analysis.weighting === "none" ? "none" : app.analysis.weighting === "1/x" ? "1/x" : "1/x squared"}. Peaks below S/N ${app.analysis.integration.minSignalToNoise} ignored.`),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["Analyte", "Cal. points", "r squared", "QL, µg/mL", "Area RSD, %", "Rs, smallest", "Content, mg/g", "Prep RSD, %", "% of claim"].map((x) => h("th", { scope: "col" }, x)))), h("tbody", {}, results))),
      h("ul", { style: "margin-top:8px" }, totalsList(app, new Map(c.analytes.map((id) => { const k = calibrationFor(app, id); return [id, k ? summarise(quantify(app.lab, m, k, app.analysis.response)) : null] as const; })))),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, `Validation evidence: ${app.catalog.solutes.get(app.analysis.solute)?.name ?? app.analysis.solute}`),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Characteristic"), h("th", { scope: "col", class: "l" }, "What the notebook shows"), h("th", { scope: "col", class: "l" }, "Status"))), h("tbody", {}, val.map((r) => h("tr", {}, h("th", { scope: "row" }, r.item), h("td", { class: "l", style: "white-space:normal" }, r.evidence), h("td", { class: "l" }, r.status === "ok" ? "evidence in hand" : r.status === "fail" ? "does not meet" : "incomplete")))))),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Run log"),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Run"), h("th", { scope: "col", class: "l" }, "Sample"), h("th", { scope: "col", class: "l" }, "Method"))), h("tbody", {}, s.runs.map((r) => h("tr", {}, h("th", { scope: "row" }, String(r.id)), h("td", { class: "l", style: "white-space:normal" }, describeSpec(r.spec, app.catalog.solutes)), h("td", { class: "l", style: "white-space:normal" }, methodSummary(app, r.method))))))),
    ),
  );
}
