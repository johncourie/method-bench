import { contentAsReceived, truthFor } from "../../lab/samples.ts";
import type { App } from "../app.ts";
import { field, h, select, sig } from "../dom.ts";

let caseId = "";
let prefix = "LAB";
let count = 12;

export function instructorView(app: App): HTMLElement {
  if (!app.catalog.cases.has(caseId)) caseId = app.lab.session.caseId;
  const c = app.catalog.cases.get(caseId)!;
  if (!app.instructorOpen) {
    return h(
      "section",
      { class: "panel" },
      h("h1", {}, "Instructor"),
      h("p", {}, "This page shows the true content of the unknown for any assignment code. It is for the person setting or marking the exercise."),
      h("p", { class: "note warn" }, "This is a static web page. Everything it knows is in the page source, so a student can find this key, and can restart a notebook to clear the record that the debrief was opened. The notebook file records every injection, which shows whether a result was earned. Mark the method and the reasoning, not only the number."),
      h("button", { type: "button", onClick: () => { app.instructorOpen = true; app.refresh(); } }, "Show the instructor key"),
    );
  }
  const codes = app.instructorCodes.split(/[\s,;]+/).filter(Boolean);
  const area = h("textarea", { rows: 5, spellcheck: "false" }, app.instructorCodes);
  area.addEventListener("change", () => { app.instructorCodes = area.value; app.refresh(); });
  const pre = h("input", { type: "text", value: prefix });
  pre.addEventListener("change", () => { prefix = pre.value.trim() || "LAB"; app.refresh(); });
  const n = h("input", { type: "number", value: count, min: 1, max: 200, step: 1 });
  n.addEventListener("change", () => { count = Math.min(200, Math.max(1, Math.round(Number(n.value) || 1))); app.refresh(); });
  const ids = [...c.analytes];
  return h(
    "div",
    { style: "display:grid;gap:16px" },
    h(
      "section",
      { class: "panel" },
      h("h1", {}, "Instructor key"),
      h(
        "div",
        { class: "cols" },
        field("Case", select(caseId, [...app.catalog.cases.values()].map((k) => ({ value: k.id, label: k.title })), (v) => { caseId = v; app.refresh(); })),
        field("Code prefix", pre),
        field("How many codes", n),
      ),
      h("div", { class: "row", style: "margin-top:8px" }, h("button", { type: "button", onClick: () => { app.instructorCodes = Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(3, "0")}`).join("\n"); app.refresh(); } }, "Generate codes")),
      h("div", { style: "margin-top:8px" }, field("Assignment codes, one per line", area)),
      h("h2", {}, "Hidden situations in this case"),
      h("ul", {}, c.variants.map((v) => h("li", {}, v.label))),
    ),
    codes.length
      ? h(
          "section",
          { class: "panel" },
          h("h2", {}, "Key"),
          h(
            "div",
            { class: "scroll" },
            h(
              "table",
              {},
              h("caption", {}, "True content as received, mg/g (after anything that happened to the lot before sampling). Results read low by the recovery unless the student corrects for it."),
              h("thead", {}, h("tr", {}, [h("th", { scope: "col" }, "Code"), h("th", { scope: "col", class: "l" }, "Situation"), h("th", { scope: "col" }, "Recovery, %"), ...ids.map((id) => h("th", { scope: "col" }, app.soluteName(id)))])),
              h("tbody", {}, codes.map((code) => {
                const t = truthFor(c, code);
                const got = contentAsReceived(c, code, app.catalog.solutes);
                return h("tr", {}, h("th", { scope: "row" }, code), h("td", { class: "l", style: "white-space:normal" }, t.variant.label), h("td", {}, (100 * t.recovery).toFixed(1)), ids.map((id) => h("td", {}, sig(got[id] ?? 0, 4))));
              })),
            ),
          ),
        )
      : null,
  );
}
