import { mean, rsdPct } from "../../engine/calibration.ts";
import { calibrate, quantify, recoveries, type Calibration, type SampleResult } from "../../lab/analysis.ts";
import type { App } from "../app.ts";
import { Chart } from "../chart.ts";
import { field, fixed, h, select, sig } from "../dom.ts";
import { methodSummary } from "./instrument.ts";

export function refMethodPicker(app: App): HTMLElement {
  const runs = app.lab.session.runs;
  const chosen = app.analysis.refRun;
  const latest = runs[runs.length - 1]?.id ?? 0;
  const options = [{ value: "latest", label: `Latest run (run ${latest})` }, ...runs.map((r) => ({ value: String(r.id), label: `Run ${r.id}: ${methodSummary(app, r.method)}`.slice(0, 90) }))];
  return field(
    "Reference method: the method of",
    select(chosen === null || !runs.some((r) => r.id === chosen) ? "latest" : String(chosen), options, (v) => { app.analysis.refRun = v === "latest" ? null : Number(v); app.analysisChanged(); }),
    "Every run made with exactly this method is used.",
  );
}

export function calibrationFor(app: App, soluteId: string): Calibration | null {
  const m = app.refMethod();
  return m ? calibrate(app.lab, m, soluteId, app.analysis.weighting, app.analysis.response, app.excluded()) : null;
}

export function summarise(results: SampleResult[]): { mean: number; rsd: number; n: number } | null {
  if (results.length === 0) return null;
  const v = results.map((r) => r.mgPerG);
  return { mean: mean(v), rsd: v.length > 1 ? rsdPct(v) : NaN, n: v.length };
}

/** Ratios and weighted totals of the case, from mean contents by analyte. */
export function totalsList(app: App, byId: ReadonlyMap<string, { mean: number } | null>): HTMLElement[] {
  const c = app.lab.case;
  const items: HTMLElement[] = [];
  for (const r of c.ratios) {
    const a = byId.get(r.num);
    const b = byId.get(r.den);
    items.push(h("li", {}, `${r.label}: ${a && b ? sig(a.mean / b.mean, 3) : "needs both analytes"}`));
  }
  for (const t of c.totals) {
    const missing = t.terms.filter((x) => !byId.get(x.id));
    if (missing.length) {
      items.push(h("li", {}, `${t.label}: needs ${missing.map((x) => app.soluteName(x.id)).join(", ")}`));
      continue;
    }
    const v = t.terms.reduce((s, x) => s + x.factor * byId.get(x.id)!.mean, 0);
    const ok = !t.limit || (t.limit.kind === "max" ? v <= t.limit.mgPerG : v >= t.limit.mgPerG);
    items.push(h("li", {}, `${t.label}: ${sig(v, 4)} mg/g`, t.limit ? [`, ${t.limit.text}: `, ok ? h("span", { class: "pass" }, "within") : h("span", { class: "fail" }, "outside")] : null));
  }
  return items;
}

export function quantView(app: App): HTMLElement {
  const m = app.refMethod();
  if (!m) return h("section", { class: "panel" }, h("h1", {}, "Quantitation"), h("p", { class: "muted" }, "Make some injections first."));
  const c = app.lab.case;
  const cal = calibrate(app.lab, m, app.analysis.solute, app.analysis.weighting, app.analysis.response, new Set());
  const used = calibrate(app.lab, m, app.analysis.solute, app.analysis.weighting, app.analysis.response, app.excluded());
  const fit = used.fit;
  const unit = m.detector.kind === "uv" ? (app.analysis.response === "area" ? "mAU min" : "mAU") : app.analysis.response === "area" ? "counts min" : "counts";

  const calRows = cal.rows.map((r) => {
    const key = `${app.analysis.solute}|${r.runId}`;
    const out = app.analysis.excluded.includes(key);
    const cb = h("input", { type: "checkbox", checked: !out });
    cb.id = `use-${r.runId}`;
    cb.setAttribute("aria-label", `Use run ${r.runId} in the calibration`);
    cb.addEventListener("change", () => {
      app.analysis.excluded = app.analysis.excluded.filter((k) => k !== key);
      if (!cb.checked) app.analysis.excluded.push(key);
      app.analysisChanged();
    });
    const resid = fit && !out ? r.y - (fit.intercept + fit.slope * r.x) : NaN;
    return h("tr", {}, h("th", { scope: "row" }, String(r.runId)), h("td", {}, cb), h("td", {}, sig(r.x, 4)), h("td", {}, sig(r.y, 5)), h("td", {}, Number.isFinite(resid) ? sig(resid, 3) : ""), h("td", {}, Number.isFinite(resid) && fit ? fixed((100 * resid) / (fit.intercept + fit.slope * r.x), 1) : ""), h("td", {}, sig(r.peak.sn, 3)));
  });

  const charts: HTMLElement[] = [];
  if (used.rows.length > 0) {
    const xs = used.rows.map((r) => r.x);
    const ys = used.rows.map((r) => r.y);
    const lo = 0;
    const hi = Math.max(...xs) * 1.05;
    const chart = new Chart(240);
    chart.set({
      series: [{ label: "standards", x: xs, y: ys, points: true }, ...(fit ? [{ label: "fit", x: [lo, hi], y: [fit.intercept + fit.slope * lo, fit.intercept + fit.slope * hi], style: 1 }] : [])],
      xLabel: "Concentration, µg/mL",
      yLabel: `Response, ${unit}`,
      summary: `Calibration of ${app.soluteName(app.analysis.solute)}: ${used.rows.length} standards from ${sig(Math.min(...xs), 3)} to ${sig(Math.max(...xs), 3)} µg/mL.`,
    });
    charts.push(chart.el);
    if (fit) {
      const rc = new Chart(180);
      rc.set({
        series: [{ label: "residuals", x: xs, y: used.rows.map((r) => (100 * (r.y - (fit.intercept + fit.slope * r.x))) / (fit.intercept + fit.slope * r.x)), points: true }, { label: "zero", x: [lo, hi], y: [0, 0], muted: true }],
        xLabel: "Concentration, µg/mL",
        yLabel: "Residual, %",
        summary: "Relative residuals of the calibration against concentration. A trend or a funnel shape means the straight line or the weighting does not describe the data.",
      });
      charts.push(rc.el);
    }
  }

  const results = quantify(app.lab, m, used, app.analysis.response);
  const sum = summarise(results);
  const claim = c.product.claim.find((k) => k.soluteId === app.analysis.solute);
  const recov = recoveries(app.lab, m, used, app.analysis.response);

  // Summary across all analytes, for ratios.
  const all = c.analytes.map((id) => {
    const k = calibrate(app.lab, m, id, app.analysis.weighting, app.analysis.response, app.excluded());
    return { id, s: summarise(quantify(app.lab, m, k, app.analysis.response)) };
  });
  const byId = new Map(all.map((a) => [a.id, a.s]));

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h(
      "section",
      { class: "panel" },
      h("h1", {}, "Quantitation"),
      h("p", { class: "muted" }, methodSummary(app, m)),
      h(
        "div",
        { class: "cols" },
        refMethodPicker(app),
        field("Analyte", select(app.analysis.solute, c.analytes.map((id) => ({ value: id, label: app.catalog.solutes.get(id)?.name ?? id })), (v) => { app.analysis.solute = v; app.analysisChanged(); })),
        field("Response", select(app.analysis.response, [{ value: "area", label: "Peak area" }, { value: "height", label: "Peak height" }], (v) => { app.analysis.response = v; app.analysisChanged(); })),
        field("Weighting", select(app.analysis.weighting, [{ value: "none", label: "None" }, { value: "1/x", label: "1/x" }, { value: "1/x2", label: "1/x squared" }], (v) => { app.analysis.weighting = v; app.analysisChanged(); })),
      ),
      cal.rows.length === 0 ? h("p", { class: "note warn", style: "margin-top:10px" }, `No standard run under this method has a peak named ${app.soluteName(app.analysis.solute)}. Inject standards at several concentrations with this method and name the peak.`) : null,
    ),
    cal.rows.length
      ? h(
          "section",
          { class: "panel" },
          h("h2", {}, "Calibration"),
          h("div", { class: "grid2" }, charts),
          h("div", { class: "scroll", style: "margin-top:10px" }, h("table", {}, h("thead", {}, h("tr", {}, ["Run", "Use", "µg/mL", `Response, ${unit}`, "Residual", "Residual, %", "S/N"].map((x) => h("th", { scope: "col" }, x)))), h("tbody", {}, calRows))),
          fit
            ? h(
                "div",
                { class: "scroll", style: "margin-top:10px" },
                h(
                  "table",
                  {},
                  h("caption", {}, "Regression"),
                  h("tbody", {}, [
                    ["Points", String(fit.n)],
                    ["Slope", `${sig(fit.slope, 5)} (standard error ${sig(fit.seSlope, 2)})`],
                    ["Intercept", `${sig(fit.intercept, 4)} (standard error ${sig(fit.seIntercept, 2)})`],
                    ["Coefficient of determination, r squared", fixed(fit.r2, 5)],
                    ["Residual standard deviation", sig(fit.sResid, 3)],
                    ["Detection limit, 3.3 s / slope", `${sig(used.dl, 2)} µg/mL`],
                    ["Quantitation limit, 10 s / slope", `${sig(used.ql, 2)} µg/mL`],
                    ["Lowest standard", `${sig(Math.min(...used.rows.map((r) => r.x)), 3)} µg/mL`],
                  ].map(([a, b]) => h("tr", {}, h("th", { scope: "row" }, a), h("td", {}, b)))),
                ),
              )
            : h("p", { class: "note warn" }, "At least three standards with different concentrations are needed for a line."),
          fit ? h("p", { class: "muted" }, app.analysis.weighting === "none" ? "Limits use the residual standard deviation of this calibration as s (ICH Q2(R2)). " : "Limits use the standard deviation of the response at the lowest standard as s, which is what the weighted fit estimates there (ICH Q2(R2)). ", "They are estimates to be confirmed by injecting a standard near the limit, and they mean little if the lowest standard is far above them. r squared alone does not show linearity: read the residual plot.") : null,
        )
      : null,
    fit
      ? h(
          "section",
          { class: "panel" },
          h("h2", {}, `Sample results: ${app.catalog.solutes.get(app.analysis.solute)?.name ?? app.analysis.solute}`),
          results.length
            ? h(
                "div",
                { class: "scroll" },
                h(
                  "table",
                  {},
                  h("thead", {}, h("tr", {}, ["Preparation", "Injections", "In vial, µg/mL", "Content, mg/g", "95% interval, mg/g", "In calibrated range"].map((x) => h("th", { scope: "col" }, x)))),
                  h("tbody", {}, results.map((r) => h("tr", {}, h("th", { scope: "row" }, String(r.prep)), h("td", {}, r.runIds.join(", ")), h("td", {}, sig(r.vial.x, 4)), h("td", {}, sig(r.mgPerG, 4)), h("td", {}, `plus or minus ${sig(r.ci95MgPerG, 2)}`), h("td", {}, r.inRange ? h("span", { class: "pass" }, "yes") : h("span", { class: "fail" }, "no, outside"))))),
                ),
              )
            : h("p", { class: "note warn" }, "No sample run under this method has this peak named. Inject the sample with this method and name the peak."),
          sum ? h("p", { style: "margin-top:8px" }, `Mean of ${sum.n} preparation(s): ${sig(sum.mean, 4)} mg/g`, Number.isFinite(sum.rsd) ? `, RSD ${fixed(sum.rsd, 1)}%` : "", claim ? `. Label claim ${claim.mgPerG} mg/g: ${fixed((100 * sum.mean) / claim.mgPerG, 1)}% of claim.` : ".") : null,
          h("p", { class: "muted" }, "The interval covers calibration and injection scatter only. It does not cover extraction recovery or a co-eluting interference."),
          recov.length
            ? h("div", { class: "scroll" }, h("table", {}, h("caption", {}, "Spike recovery"), h("thead", {}, h("tr", {}, ["Run", "Added, µg/mL", "Found, µg/mL", "Recovery, %"].map((x) => h("th", { scope: "col" }, x)))), h("tbody", {}, recov.map((r) => h("tr", {}, h("th", { scope: "row" }, String(r.runId)), h("td", {}, sig(r.addedUgMl, 3)), h("td", {}, sig(r.foundUgMl, 3)), h("td", {}, fixed(r.recoveryPct, 1)))))))
            : null,
        )
      : null,
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "All analytes and ratios"),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, h("tr", {}, ["Analyte", "Mean content, mg/g", "Preparations", "RSD, %"].map((x) => h("th", { scope: "col" }, x)))), h("tbody", {}, all.map((a) => h("tr", {}, h("th", { scope: "row" }, app.catalog.solutes.get(a.id)?.name ?? a.id), h("td", {}, a.s ? sig(a.s.mean, 4) : "not determined"), h("td", {}, a.s ? String(a.s.n) : ""), h("td", {}, a.s && Number.isFinite(a.s.rsd) ? fixed(a.s.rsd, 1) : "")))))),
      h("ul", { style: "margin-top:8px" }, totalsList(app, byId)),
    ),
  );
}
