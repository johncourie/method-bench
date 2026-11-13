// Compare runs: chromatograms overlaid or spread into a waterfall, coloured by a
// variable of the student's choosing. The table carries the same information as text.

import { BUFFERS } from "../../engine/tunables.ts";
import { describeSpec } from "../../lab/samples.ts";
import type { RunRecord } from "../../lab/types.ts";
import type { App } from "../app.ts";
import { field, h, select } from "../dom.ts";
import { CATEGORICAL, ramp } from "../three/common.ts";
import { Waterfall, type Trace } from "../three/waterfall.ts";
import { methodSummary } from "./instrument.ts";

export type ColourBy = "run" | "sample" | "column" | "buffer" | "temp" | "ph" | "flow" | "tg" | "phi0" | "inj";

const CHOICES: ReadonlyArray<{ value: ColourBy; label: string; numeric: boolean; of: (app: App, r: RunRecord) => number | string; unit: string }> = [
  { value: "run", label: "Run", numeric: false, of: (_a, r) => `Run ${r.id}`, unit: "" },
  { value: "sample", label: "Kind of sample", numeric: false, of: (_a, r) => (r.spec.kind === "blank" ? "Blank" : r.spec.stress ? "Stressed" : r.spec.kind === "standard" ? "Standard" : Object.values(r.spec.spike ?? {}).some((v) => v > 0) ? "Spiked sample" : "Sample"), unit: "" },
  { value: "column", label: "Column", numeric: false, of: (a, r) => a.catalog.columns.get(r.method.columnId)?.name ?? r.method.columnId, unit: "" },
  { value: "buffer", label: "Buffer", numeric: false, of: (_a, r) => BUFFERS[r.method.buffer ?? ""]?.name ?? "None", unit: "" },
  { value: "temp", label: "Column temperature", numeric: true, of: (_a, r) => r.method.tempC, unit: "°C" },
  { value: "ph", label: "Solvent A pH", numeric: true, of: (_a, r) => r.method.pH, unit: "" },
  { value: "flow", label: "Flow", numeric: true, of: (_a, r) => r.method.flowMlMin, unit: "mL/min" },
  { value: "tg", label: "Gradient time", numeric: true, of: (_a, r) => r.method.program[r.method.program.length - 1]!.t - r.method.program[0]!.t, unit: "min" },
  { value: "phi0", label: "Starting % B", numeric: true, of: (_a, r) => Math.round(r.method.program[0]!.phi * 1000) / 10, unit: "% B" },
  { value: "inj", label: "Injection volume", numeric: true, of: (_a, r) => r.method.injUl, unit: "µL" },
];

let scene: Waterfall | null = null;
let failed = false;
let loading = false;

export function compareView(app: App): HTMLElement {
  const runs = app.lab.session.runs;
  if (runs.length === 0) return h("section", { class: "panel" }, h("h1", {}, "Compare runs"), h("p", { class: "muted" }, "Make some injections first."));
  const c = app.compare;
  if (!c.touched) for (const r of runs.slice(-6)) c.runs.add(r.id);
  const chosen = runs.filter((r) => c.runs.has(r.id));
  const choice = CHOICES.find((x) => x.value === c.by)!;

  // Colours: one per distinct value for categories, a ramp from low to high for numbers.
  const values = chosen.map((r) => choice.of(app, r));
  const distinct = [...new Set(values)];
  const nums = values.filter((v): v is number => typeof v === "number");
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const colourOf = (v: number | string): string => (typeof v === "number" ? ramp(hi > lo ? (0.9 * (v - lo)) / (hi - lo) : 0.3) : CATEGORICAL[distinct.indexOf(v) % CATEGORICAL.length]!);

  const executed = chosen.map((r) => app.lab.execute(r));
  const traces: Trace[] = executed.map((ex, i) => ({ label: String(ex.record.id), colour: colourOf(values[i]!), time: ex.result.time, signal: ex.result.signal }));
  const units = [...new Set(executed.map((ex) => ex.result.unit))];

  const holder = h("div", { class: "bench-holder tall" });
  if (scene) {
    holder.appendChild(scene.el);
    const s = scene;
    requestAnimationFrame(() => s.set(traces, { spacing: c.spacing, normalise: c.normalise || units.length > 1, window: null, unit: units[0] ?? "" }));
  } else if (failed) {
    holder.appendChild(h("p", { class: "note warn" }, "The drawing needs WebGL, which this browser has turned off or does not have. The table below lists the same runs."));
  } else {
    holder.appendChild(h("p", { class: "muted" }, "Loading the drawing."));
    if (!loading) {
      loading = true;
      Waterfall.create().then((w) => { scene = w; }, () => { failed = true; }).finally(() => { loading = false; app.refresh(); });
    }
  }

  const depth = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: c.spacing });
  depth.addEventListener("change", () => { c.spacing = Number(depth.value); app.refresh(); });
  const norm = h("input", { type: "checkbox", checked: c.normalise });
  norm.id = "compare-normalise";
  norm.addEventListener("change", () => { c.normalise = norm.checked; app.refresh(); });

  const pick = runs.map((r) => {
    const cb = h("input", { type: "checkbox", checked: c.runs.has(r.id) });
    cb.id = `cmp-${r.id}`;
    cb.setAttribute("aria-label", `Show run ${r.id}`);
    cb.addEventListener("change", () => {
      c.touched = true;
      if (cb.checked) c.runs.add(r.id);
      else c.runs.delete(r.id);
      app.refresh();
    });
    return h("tr", {}, h("th", { scope: "row" }, String(r.id)), h("td", {}, cb), h("td", { class: "l wrap" }, describeSpec(r.spec, app.catalog.solutes)), h("td", { class: "l wrap" }, methodSummary(app, r.method)));
  });

  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h(
      "section",
      { class: "panel" },
      h("h1", {}, "Compare runs"),
      h("p", { class: "lede" }, "Tick the runs to compare and choose what the colour stands for. With no depth the traces are overlaid. Pull them apart to see each one whole, then drag to turn the view."),
      h(
        "div",
        { class: "cols" },
        field("Colour stands for", select(c.by, CHOICES.map((x) => ({ value: x.value, label: x.label })), (v) => { c.by = v; app.refresh(); })),
        field("Depth between traces", depth, "Left end overlays them."),
        h("div", { class: "check" }, norm, h("label", { for: "compare-normalise" }, "Scale each trace to its tallest peak")),
        h("div", { class: "row" }, h("button", { type: "button", class: "small", onClick: () => scene?.view(c.spacing) }, "Reset the view")),
      ),
      units.length > 1 ? h("p", { class: "note" }, "These runs used different detectors, so each trace is scaled to its own tallest peak.") : null,
      holder,
      chosen.length === 0 ? h("p", { class: "note warn" }, "No runs ticked.") : null,
      h(
        "div",
        { class: "scroll", style: "margin-top:10px" },
        h(
          "table",
          {},
          h("caption", {}, `Traces shown. Colour stands for: ${choice.label}${choice.numeric && nums.length ? ` (${lo} to ${hi}${choice.unit ? ` ${choice.unit}` : ""}, dark to light)` : ""}`),
          h("thead", {}, h("tr", {}, ["Run", "Colour", choice.label, "Peaks", "Sample", "Method"].map((x, i) => h("th", { scope: "col", class: i >= 4 ? "l" : "" }, x)))),
          h("tbody", {}, executed.map((ex, i) => h("tr", {}, h("th", { scope: "row" }, String(ex.record.id)), h("td", {}, h("span", { class: "swatch", style: `background:${traces[i]!.colour}` })), h("td", {}, `${values[i]}${choice.numeric && choice.unit ? ` ${choice.unit}` : ""}`), h("td", {}, String(ex.integration.peaks.length)), h("td", { class: "l wrap" }, describeSpec(ex.record.spec, app.catalog.solutes)), h("td", { class: "l wrap" }, methodSummary(app, ex.record.method))))),
        ),
      ),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, "Runs"),
      h("div", { class: "row", style: "margin-bottom:8px" }, h("button", { type: "button", class: "small", onClick: () => { c.touched = true; for (const r of runs) c.runs.add(r.id); app.refresh(); } }, "Tick all"), h("button", { type: "button", class: "small", onClick: () => { c.touched = true; c.runs.clear(); app.refresh(); } }, "Clear")),
      h("div", { class: "scroll", style: "max-height:320px;overflow-y:auto" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Run"), h("th", { scope: "col" }, "Show"), h("th", { scope: "col", class: "l" }, "Sample"), h("th", { scope: "col", class: "l" }, "Method"))), h("tbody", {}, pick))),
    ),
  );
}
