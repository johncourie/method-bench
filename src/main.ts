import { catalog } from "./data/index.ts";
import { App, TABS, type TabId } from "./ui/app.ts";
import { loadSample, SAMPLES } from "./ui/samples.ts";
import { compareView } from "./ui/views/compare.ts";
import { instructorView } from "./ui/views/instructor.ts";
import { instrumentView } from "./ui/views/instrument.ts";
import { limitsView } from "./ui/views/limits.ts";
import { modelView } from "./ui/views/model.ts";
import { quantView } from "./ui/views/quant.ts";
import { reportView } from "./ui/views/report.ts";
import { setupView } from "./ui/views/setup.ts";
import { validationView } from "./ui/views/validation.ts";

const VERSION = "0.9.0";

const app = new App(catalog, VERSION);
app.register("setup", setupView);
app.register("instrument", instrumentView);
app.register("compare", compareView);
app.register("model", modelView);
app.register("quant", quantView);
app.register("validation", validationView);
app.register("report", reportView);
app.register("limits", limitsView);
app.register("instructor", instructorView);

// A link of the form ?sample=name opens a sample notebook, unless a notebook is already in progress here.
const wanted = new URLSearchParams(location.search).get("sample");
if (wanted && SAMPLES.some((s) => s.id === wanted)) {
  if (app.lab.session.runs.length === 0) {
    loadSample(app, wanted).then(
      () => { app.message = { kind: "ok", text: "Sample notebook loaded." }; app.go(TABS.some((t) => t.id === location.hash.slice(1)) ? (location.hash.slice(1) as TabId) : "instrument"); },
      (e: unknown) => { app.message = { kind: "bad", text: e instanceof Error ? e.message : String(e) }; app.go("setup"); },
    );
  } else {
    app.message = { kind: "bad", text: "You have a notebook in progress here, so the sample was not loaded over it. Use the sample's button below if you want to replace it." };
    app.tab = "setup";
    location.hash = "";
  }
}

const fromHash = location.hash.slice(1) as TabId;
if (TABS.some((t) => t.id === fromHash)) app.tab = fromHash;

// Theme: follow the system unless the viewer chose one.
const themeButton = document.getElementById("theme");
const applyTheme = (t: string | null): void => {
  if (t) document.documentElement.setAttribute("data-theme", t);
  const dark = t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (themeButton) {
    themeButton.textContent = dark ? "Light theme" : "Dark theme";
    themeButton.setAttribute("aria-pressed", String(dark));
  }
};
let stored: string | null = null;
try {
  stored = localStorage.getItem("method-bench-theme");
} catch {
  // Storage blocked: fall back to the system theme.
}
applyTheme(stored);
themeButton?.addEventListener("click", () => {
  const dark = document.documentElement.getAttribute("data-theme") === "dark" || (!document.documentElement.hasAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("method-bench-theme", next);
  } catch {
    // Not remembered; still applied for this visit.
  }
  app.refresh();
});

const version = document.getElementById("version");
if (version) version.textContent = `Version ${VERSION}.`;
app.refresh();

// Exposed for end-to-end tests.
(window as unknown as { methodBench: App }).methodBench = app;
