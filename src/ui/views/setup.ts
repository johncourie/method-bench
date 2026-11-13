import type { App } from "../app.ts";
import { field, h, select } from "../dom.ts";

function download(name: string, text: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let pending: { caseId: string; seed: string; instrumentId: string; student: string } | null = null;

export function setupView(app: App): HTMLElement {
  const s = app.lab.session;
  const draft = pending ?? { caseId: s.caseId, seed: s.seed, instrumentId: s.instrumentId, student: s.student };
  pending = draft;
  const c = app.catalog.cases.get(draft.caseId)!;
  const hasRuns = s.runs.length > 0;
  const changed = draft.caseId !== s.caseId || draft.seed.trim() !== s.seed || draft.instrumentId !== s.instrumentId;

  const cases = h(
    "div",
    { class: "cards", role: "group", "aria-label": "Case" },
    [...app.catalog.cases.values()].map((k) =>
      h(
        "button",
        {
          type: "button",
          class: "card",
          "aria-pressed": String(k.id === draft.caseId),
          onClick: () => {
            draft.caseId = k.id;
            app.refresh();
          },
        },
        h("strong", {}, k.title),
        h("p", { class: "muted" }, k.product.name),
      ),
    ),
  );

  const seed = h("input", { type: "text", value: draft.seed, autocomplete: "off", spellcheck: "false" });
  seed.addEventListener("change", () => {
    draft.seed = seed.value;
    app.refresh();
  });
  const student = h("input", { type: "text", value: draft.student, autocomplete: "name" });
  student.addEventListener("change", () => {
    draft.student = student.value;
    s.student = student.value;
    app.persist();
  });
  const instruments = [...app.catalog.instruments.values()];
  const inst = app.catalog.instruments.get(draft.instrumentId)!;

  const start = h(
    "button",
    {
      type: "button",
      class: "primary",
      onClick: () => {
        app.reset(draft.caseId, draft.seed, draft.instrumentId, draft.student);
        pending = null;
        app.go("instrument");
      },
    },
    hasRuns ? "Discard this notebook and start a new one" : "Start",
  );

  const file = h("input", { type: "file", accept: "application/json,.json" });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (!f) return;
    void f.text().then((text) => {
      try {
        app.importSession(text);
        pending = null;
        app.message = { kind: "ok", text: "Notebook loaded." };
        app.go("instrument");
      } catch (e) {
        app.message = { kind: "bad", text: e instanceof Error ? e.message : String(e) };
        app.refresh();
      }
    });
  });

  return h(
    "div",
    { class: "grid2" },
    h(
      "section",
      { class: "panel" },
      h("h1", {}, "Setup"),
      h("p", { class: "lede" }, "Choose a case, enter the assignment code your instructor gave you, and pick an instrument. The code fixes your unknown sample, so the same code always gives the same sample."),
      h("h2", {}, "Case"),
      cases,
      h("div", { class: "cols", style: "margin-top:12px" }, field("Assignment code", seed, "Any text. Use DEMO-0001 to explore."), field("Your name (for the report)", student), field("Instrument", select(draft.instrumentId, instruments.map((i) => ({ value: i.id, label: i.name })), (v) => { draft.instrumentId = v; app.refresh(); }))),
      h("p", { class: "muted", style: "margin-top:8px" }, `Dwell volume ${inst.dwellMl} mL. Pressure limit ${inst.pMaxBar} bar. Flow cell ${inst.pathCm} cm.`),
      hasRuns && changed ? h("p", { class: "note warn" }, `Your notebook has ${s.runs.length} injection(s) under code ${s.seed}. Starting again discards them. Download the notebook first if you want to keep it.`) : null,
      h("div", { class: "row", style: "margin-top:8px" }, hasRuns && !changed ? h("button", { type: "button", class: "primary", onClick: () => app.go("instrument") }, "Continue this notebook") : null, !hasRuns || changed ? start : null),
      app.message ? h("p", { class: `note ${app.message.kind === "bad" ? "bad" : ""}` }, app.message.text) : null,
      h("h2", { style: "margin-top:16px" }, "Notebook file"),
      h("p", { class: "muted" }, "The notebook holds every injection you made. Results are recomputed from it, so it reproduces exactly on another computer."),
      h("div", { class: "row" }, h("button", { type: "button", onClick: () => download(`method-bench-${s.caseId}-${s.seed}.json`, app.exportSession()) }, "Download notebook"), field("Load a notebook", file)),
    ),
    h(
      "section",
      { class: "panel" },
      h("h2", {}, c.title),
      h("p", {}, c.brief),
      h("h3", {}, "Product"),
      h("p", {}, c.product.name),
      h("ul", {}, c.product.claim.map((k) => h("li", {}, `Label claim: ${app.soluteName(k.soluteId)} ${k.mgPerG} mg/g`))),
      h("h3", {}, "Reference standards available"),
      h("p", {}, [...c.analytes, ...c.extraStandards].map((id) => app.catalog.solutes.get(id)?.name ?? id).join(", "), "."),
      h("h3", {}, "How the bench works"),
      h(
        "ul",
        {},
        h("li", {}, "Every injection costs instrument time and solvent. The running total is at the top of the page."),
        h("li", {}, "The chromatogram is all you get. Peaks are not named for you: inject standards to find out which peak is which."),
        h("li", {}, "Fit and predict lets you build a retention model from your own scouting runs and test it against a real injection."),
        h("li", {}, "Quantitation and validation use the method of the run you mark as the reference method."),
      ),
    ),
  );
}
