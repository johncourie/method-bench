import { peakPurity, PURITY_LIMIT, quantify, recoveries, runsOfMethod, suitability } from "../../lab/analysis.ts";
import { rsdPct } from "../../engine/calibration.ts";
import { methodKey } from "../../lab/session.ts";
import type { App } from "../app.ts";
import { field, fixed, h, numberInput, sig } from "../dom.ts";
import { methodSummary } from "./instrument.ts";
import { calibrationFor, refMethodPicker } from "./quant.ts";

const verdict = (ok: boolean): HTMLElement => (ok ? h("span", { class: "pass" }, "meets") : h("span", { class: "fail" }, "fails"));

/** One line per ICH Q2(R2) performance characteristic for one analyte. Exported for the report. */
export function validationRows(app: App, soluteId: string): Array<{ item: string; evidence: string; status: "ok" | "gap" | "fail" }> {
  const m = app.refMethod();
  if (!m) return [];
  const rows: Array<{ item: string; evidence: string; status: "ok" | "gap" | "fail" }> = [];
  const runs = runsOfMethod(app.lab, m);
  const cal = calibrationFor(app, soluteId);
  const std = runs.find((ex) => ex.record.spec.kind === "standard" && app.lab.peakOf(ex, soluteId));
  const tR = std ? app.lab.peakOf(std, soluteId)!.tR : NaN;

  // Specificity: blank clean at the analyte position, analyte resolved in the sample, spectrum uniform, stressed sample examined.
  const blanks = runs.filter((ex) => ex.record.spec.kind === "blank");
  const sample = runs.find((ex) => ex.record.spec.kind === "unknown" && !ex.record.spec.stress && app.lab.peakOf(ex, soluteId));
  const stressed = runs.filter((ex) => ex.record.spec.kind !== "blank" && ex.record.spec.stress);
  const parts: string[] = [];
  let spec: "ok" | "gap" | "fail" = "ok";
  if (blanks.length === 0 || !Number.isFinite(tR)) {
    parts.push("no blank run");
    spec = "gap";
  } else {
    const hit = blanks.some((ex) => ex.integration.peaks.some((p) => Math.abs(p.tR - tR) / tR < 0.025));
    parts.push(hit ? "blank shows a peak at the analyte position" : "blank clean at the analyte position");
    if (hit) spec = "fail";
  }
  if (!sample) {
    parts.push("no sample run with this peak named");
    spec = spec === "fail" ? "fail" : "gap";
  } else {
    const p = app.lab.peakOf(sample, soluteId)!;
    const next = sample.integration.peaks.find((q) => q.n === p.n + 1);
    const rs = Math.min(Number.isFinite(p.resolution) ? p.resolution : Infinity, next && Number.isFinite(next.resolution) ? next.resolution : Infinity);
    parts.push(`resolution to nearest peak in the sample ${Number.isFinite(rs) ? fixed(rs, 2) : "not limited"}`);
    if (rs < 1.5) spec = "fail";
    if (m.detector.kind === "uv") {
      const pur = peakPurity(app.lab, sample, p);
      parts.push(Number.isNaN(pur.match) ? "peak too small for a spectral purity check" : `spectral match across the peak ${fixed(pur.match, 1)} of 1000`);
      if (pur.match < PURITY_LIMIT) spec = "fail";
    }
  }
  // A stressed solution counts only if the analyte peak is still found in it and separated from what formed.
  const stressedOk = stressed.filter((ex) => {
    const p = app.lab.peakOf(ex, soluteId);
    if (!p) return false;
    const next = ex.integration.peaks.find((q) => q.n === p.n + 1);
    return Math.min(Number.isFinite(p.resolution) ? p.resolution : Infinity, next && Number.isFinite(next.resolution) ? next.resolution : Infinity) >= 1.5;
  });
  parts.push(stressed.length ? `${stressed.length} stressed solution(s) run with this method, analyte named and resolved (Rs at least 1.5) in ${stressedOk.length}` : "no forced-degradation run");
  if (stressed.length === 0 && spec === "ok") spec = "gap";
  if (stressed.length > 0 && stressedOk.length < stressed.length && spec === "ok") spec = "gap";
  rows.push({ item: "Specificity", evidence: parts.join("; "), status: spec });

  // Linearity and range.
  if (cal?.fit) {
    const xs = cal.rows.map((r) => r.x);
    const levels = new Set(xs).size;
    const worst = Math.max(...cal.rows.map((r) => Math.abs((100 * (r.y - (cal.fit!.intercept + cal.fit!.slope * r.x))) / (cal.fit!.intercept + cal.fit!.slope * r.x))));
    rows.push({ item: "Response (linearity) and range", evidence: `${app.analysis.weighting === "none" ? "unweighted" : app.analysis.weighting === "1/x" ? "1/x weighted" : "1/x squared weighted"} line, ${levels} level(s), ${sig(Math.min(...xs), 3)} to ${sig(Math.max(...xs), 3)} µg/mL; r squared ${fixed(cal.fit.r2, 4)}; largest relative residual ${fixed(worst, 1)}%`, status: levels >= 5 ? (worst <= 5 ? "ok" : "fail") : "gap" });
    rows.push({ item: "Detection and quantitation limits", evidence: `${sig(cal.dl, 2)} and ${sig(cal.ql, 2)} µg/mL from the calibration; lowest standard ${sig(Math.min(...xs), 3)} µg/mL`, status: Math.min(...xs) <= 3 * cal.ql ? "ok" : "gap" });
  } else {
    rows.push({ item: "Response (linearity) and range", evidence: "no calibration under this method", status: "gap" });
    rows.push({ item: "Detection and quantitation limits", evidence: "no calibration under this method", status: "gap" });
  }

  // Accuracy by spike recovery.
  const rec = cal ? recoveries(app.lab, m, cal, app.analysis.response) : [];
  if (rec.length === 0) rows.push({ item: "Accuracy", evidence: "no spiked sample with a matching unspiked one", status: "gap" });
  else {
    const v = rec.map((r) => r.recoveryPct);
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const levels = new Set(rec.map((r) => r.addedUgMl)).size;
    const enough = rec.length >= 9 && levels >= 3;
    rows.push({ item: "Accuracy (spike recovery)", evidence: `${rec.length} spiked determination(s) at ${levels} level(s), recovery ${fixed(lo, 1)} to ${fixed(hi, 1)}%. Spikes go in before extraction, so this figure includes extraction loss.`, status: enough ? (lo >= 90 && hi <= 110 ? "ok" : "fail") : "gap" });
  }

  // Repeatability: replicate injections of one standard.
  const sst = suitability(app.lab, m, soluteId);
  if (!sst) rows.push({ item: "System precision (injection repeatability)", evidence: "fewer than two replicate injections of one standard", status: "gap" });
  else rows.push({ item: "System precision (injection repeatability)", evidence: `${sst.n} replicate injections of one standard vial, area RSD ${fixed(sst.areaRsd, 2)}%, retention time RSD ${fixed(sst.tRRsd, 2)}%`, status: sst.n >= 6 ? (sst.areaRsd <= app.analysis.criteria.areaRsd ? "ok" : "fail") : "gap" });
  // Repeatability of the whole procedure: independent preparations of the sample.
  const preps = cal ? quantify(app.lab, m, cal, app.analysis.response) : [];
  if (preps.length < 2) rows.push({ item: "Repeatability (independent preparations)", evidence: `${preps.length} sample preparation(s) quantified`, status: "gap" });
  else rows.push({ item: "Repeatability (independent preparations)", evidence: `${preps.length} sample preparations, content RSD ${fixed(rsdPct(preps.map((p) => p.mgPerG)), 2)}%`, status: preps.length >= 6 ? "ok" : "gap" });

  // Robustness: runs that differ from the reference in exactly one setting.
  const varied = robustness(app, soluteId);
  rows.push({ item: "Robustness", evidence: varied.length ? `${varied.length} deliberate variation(s) run; smallest resolution ${fixed(Math.min(...varied.map((v) => v.rs)), 2)}` : "no run that differs from the method in exactly one setting", status: varied.length >= 3 ? (Math.min(...varied.map((v) => v.rs)) >= 1.5 ? "ok" : "fail") : "gap" });
  return rows;
}

interface Varied {
  runId: number;
  change: string;
  tR: number;
  dTR: number;
  rs: number;
}

/** Runs differing from the reference method in exactly one of temperature, pH, flow or programme. */
export function robustness(app: App, soluteId: string): Varied[] {
  const m = app.refMethod();
  if (!m) return [];
  const ref = runsOfMethod(app.lab, m).find((ex) => app.lab.peakOf(ex, soluteId));
  if (!ref) return [];
  const refT = app.lab.peakOf(ref, soluteId)!.tR;
  const out: Varied[] = [];
  for (const r of app.lab.session.runs) {
    if (methodKey(r.method) === methodKey(m) || r.method.columnId !== m.columnId || r.method.modifier !== m.modifier || JSON.stringify(r.method.detector) !== JSON.stringify(m.detector)) continue;
    const diffs: string[] = [];
    if (r.method.tempC !== m.tempC) diffs.push(`temperature ${r.method.tempC} °C`);
    if (r.method.pH !== m.pH) diffs.push(`pH ${r.method.pH}`);
    if (r.method.flowMlMin !== m.flowMlMin) diffs.push(`flow ${r.method.flowMlMin} mL/min`);
    if (JSON.stringify(r.method.program) !== JSON.stringify(m.program)) diffs.push("gradient or % B");
    if (diffs.length !== 1) continue;
    const ex = app.lab.execute(r);
    // Names do not carry across methods, so match the analyte by elution position among named peaks of this run.
    const p = app.lab.peakOf(ex, soluteId);
    if (!p) continue;
    const next = ex.integration.peaks.find((q) => q.n === p.n + 1);
    const rs = Math.min(Number.isFinite(p.resolution) ? p.resolution : Infinity, next && Number.isFinite(next.resolution) ? next.resolution : Infinity);
    out.push({ runId: r.id, change: diffs[0]!, tR: p.tR, dTR: p.tR - refT, rs });
  }
  return out;
}

export function validationView(app: App): HTMLElement {
  const m = app.refMethod();
  if (!m) return h("section", { class: "panel" }, h("h1", {}, "Suitability and validation"), h("p", { class: "muted" }, "Make some injections first."));
  const c = app.lab.case;
  const k = app.analysis.criteria;
  const gradient = m.program.some((p) => p.phi !== m.program[0]!.phi);
  const sstRows = c.analytes.map((id) => {
    const s = suitability(app.lab, m, id);
    if (!s) return h("tr", {}, h("th", { scope: "row" }, app.soluteName(id)), h("td", { class: "l", colspan: 7 }, "needs at least two replicate injections of one standard with this peak named"));
    // In a gradient the plate number is only apparent, so it is shown but not judged.
    const ok = s.areaRsd <= k.areaRsd && s.resolutionMin >= k.resolution && s.symmetry >= k.symLo && s.symmetry <= k.symHi && (gradient || s.plates >= k.plates);
    return h("tr", {}, h("th", { scope: "row" }, app.soluteName(id)), h("td", {}, String(s.n)), h("td", {}, fixed(s.tRMean, 2)), h("td", {}, fixed(s.areaRsd, 2)), h("td", {}, Number.isFinite(s.resolutionMin) ? fixed(s.resolutionMin, 2) : "alone"), h("td", {}, fixed(s.symmetry, 2)), h("td", {}, Number.isFinite(s.plates) ? String(Math.round(s.plates)) : "n/a"), h("td", {}, verdict(ok)));
  });

  const rob = robustness(app, app.analysis.solute);
  const val = validationRows(app, app.analysis.solute);
  const mark = (s: "ok" | "gap" | "fail"): HTMLElement => (s === "ok" ? h("span", { class: "pass" }, "evidence in hand") : s === "fail" ? h("span", { class: "fail" }, "does not meet") : h("span", { class: "muted" }, "incomplete"));

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h("section", { class: "panel" }, h("h1", {}, "Suitability and validation"), h("p", { class: "muted" }, methodSummary(app, m)), h("div", { class: "cols" }, refMethodPicker(app))),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "System suitability"),
      h("p", { class: "muted" }, "From replicate injections of one standard solution. Resolution, plate number and symmetry factor are computed from widths at half height and at 5% height, as in the harmonized pharmacopoeial chromatography chapter."),
      h(
        "div",
        { class: "cols" },
        field("Area RSD at most, %", numberInput(k.areaRsd, { min: 0.1, step: 0.1, onChange: (v) => { k.areaRsd = v; app.analysisChanged(); } })),
        field("Resolution at least", numberInput(k.resolution, { min: 0.5, step: 0.1, onChange: (v) => { k.resolution = v; app.analysisChanged(); } })),
        field("Symmetry from", numberInput(k.symLo, { min: 0.1, step: 0.1, onChange: (v) => { k.symLo = v; app.analysisChanged(); } })),
        field("Symmetry to", numberInput(k.symHi, { min: 0.5, step: 0.1, onChange: (v) => { k.symHi = v; app.analysisChanged(); } })),
        field("Plates at least", numberInput(k.plates, { min: 100, step: 100, onChange: (v) => { k.plates = v; app.analysisChanged(); } })),
      ),
      h("div", { class: "scroll", style: "margin-top:10px" }, h("table", {}, h("thead", {}, h("tr", {}, ["Analyte", "n", "tR, min", "Area RSD, %", "Rs, smallest", "Symmetry", gradient ? "Plates (apparent)" : "Plates", "Criteria"].map((x) => h("th", { scope: "col" }, x)))), h("tbody", {}, sstRows))),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, `Validation evidence: ${app.catalog.solutes.get(app.analysis.solute)?.name ?? app.analysis.solute}`),
      h("p", { class: "muted" }, "The characteristics are those of ICH Q2(R2). The table reports what your notebook contains for each; it does not decide whether the method is fit for its purpose. Change the analyte on the Quantitation tab."),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Characteristic"), h("th", { scope: "col", class: "l" }, "What the notebook shows"), h("th", { scope: "col", class: "l" }, "Status"))), h("tbody", {}, val.map((r) => h("tr", {}, h("th", { scope: "row" }, r.item), h("td", { class: "l", style: "white-space:normal" }, r.evidence), h("td", { class: "l" }, mark(r.status))))))),
      h("p", { class: "muted", style: "margin-top:8px" }, "Reference points used here, after ICH Q2(R2): response at five or more levels; accuracy from nine determinations over three levels; system precision from six injections; repeatability from six independent preparations; three or more deliberate variations for robustness. These are common minimums, and the acceptance limits applied (recovery 90 to 110%, residuals within 5%) are placeholders for the limits a real method would justify. Intermediate precision needs different days, analysts or instruments and is outside this bench."),
      rob.length
        ? h("div", { class: "scroll", style: "margin-top:10px" }, h("table", {}, h("caption", {}, "Deliberate variations"), h("thead", {}, h("tr", {}, ["Run", "Changed", "tR, min", "Shift, min", "Rs, smallest"].map((x, i) => h("th", { scope: "col", class: i === 1 ? "l" : "" }, x)))), h("tbody", {}, rob.map((v) => h("tr", {}, h("th", { scope: "row" }, String(v.runId)), h("td", { class: "l" }, v.change), h("td", {}, fixed(v.tR, 2)), h("td", {}, fixed(v.dTR, 2)), h("td", {}, Number.isFinite(v.rs) ? fixed(v.rs, 2) : "alone"))))))
        : null,
    ),
  );
}
