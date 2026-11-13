// Application state and the render loop. Views are plain functions of this state.

import type { Method } from "../engine/types.ts";
import { Lab, loadSession, newSession, saveSession, type Catalog } from "../lab/session.ts";
import type { AnalysisSettings, SampleSpec, StressAgent } from "../lab/types.ts";
import { clear, h, resetIds, slug } from "./dom.ts";

export type TabId = "setup" | "instrument" | "compare" | "model" | "quant" | "validation" | "report" | "limits" | "instructor";

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "setup", label: "Setup" },
  { id: "instrument", label: "Instrument" },
  { id: "compare", label: "Compare runs" },
  { id: "model", label: "Fit and predict" },
  { id: "quant", label: "Quantitation" },
  { id: "validation", label: "Suitability and validation" },
  { id: "report", label: "Report" },
  { id: "limits", label: "Model and limits" },
  { id: "instructor", label: "Instructor" },
];

/** What the student has dialled in at the sample bench, before pressing Inject. */
export interface SampleDraft {
  kind: "blank" | "standard" | "unknown";
  levels: Record<string, number>;
  prep: number;
  mg: number;
  ml: number;
  dilution: number;
  spike: Record<string, number>;
  stressOn: boolean;
  stress: { agent: StressAgent; hours: number; tempC: number };
  replicates: number;
  diluentPct: number;
}

const STORE_KEY = "method-bench-session-v1";
const DEFAULT_MAP = { tgMin: 5, tgMax: 40, phiMin: 0.05, phiMax: 0.5, phiEnd: 0.95 };

export class App {
  lab: Lab;
  tab: TabId = "setup";
  method: Method;
  sample: SampleDraft;
  selectedRun: number | null = null;
  overlayRun: number | null = null;
  selectedPeak: number | null = null;
  message: { kind: "ok" | "bad"; text: string } | null = null;
  /** False once the browser has refused to store the notebook. */
  stored = true;
  // Fit and predict: working state, not part of the notebook.
  fitRuns = new Set<number>();
  fitT0: number | null = null;
  fitPlates = 10000;
  map = { ...DEFAULT_MAP };
  /** Compare runs: which runs, what colour stands for, and how far apart the traces sit. */
  compare: { runs: Set<number>; touched: boolean; by: "run" | "sample" | "column" | "buffer" | "temp" | "ph" | "flow" | "tg" | "phi0" | "inj"; spacing: number; normalise: boolean } = { runs: new Set(), touched: false, by: "run", spacing: 0.5, normalise: false };
  /** Whether the instrument drawing is shown. */
  showBench = true;
  instructorCodes = "";
  instructorOpen = false;
  private views = new Map<TabId, (app: App) => HTMLElement>();
  private openDetails = new Set<string>();
  private pointerDown = false;
  private pending = false;
  private timer: number | null = null;

  constructor(
    readonly catalog: Catalog,
    readonly version: string,
  ) {
    const first = [...catalog.cases.values()][0];
    const inst = [...catalog.instruments.values()][0];
    if (!first || !inst) throw new Error("no cases or instruments in the catalog");
    let session = newSession(first, "DEMO-0001", inst.id);
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) session = loadSession(saved, catalog);
    } catch {
      // Storage blocked, or a stored notebook this version cannot read: start fresh.
    }
    this.lab = new Lab(catalog, session);
    this.method = structuredClone(this.lab.case.defaultMethod);
    this.sample = this.freshSample();
    const last = session.runs[session.runs.length - 1];
    if (last) {
      this.selectedRun = last.id;
      this.method = structuredClone(last.method);
      this.tab = "instrument";
    }
    // A change event fires when a field loses focus, which is often the press of a
    // button. Rebuilding the page at that instant would destroy the button before its
    // click arrives, so drawing waits until the pointer is released.
    document.addEventListener("pointerdown", () => { this.pointerDown = true; }, true);
    const release = (): void => {
      window.setTimeout(() => {
        this.pointerDown = false;
        if (this.pending) this.refresh();
      }, 0);
    };
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    window.addEventListener("hashchange", () => {
      const t = location.hash.slice(1) as TabId;
      if (t !== this.tab && TABS.some((x) => x.id === t)) this.go(t);
    });
  }

  /** How the student is processing the data. Stored in the notebook. */
  get analysis(): AnalysisSettings {
    return this.lab.session.analysis;
  }

  /** Call after changing anything under `analysis`. */
  analysisChanged(reintegrate = false): void {
    if (reintegrate) this.lab.reintegrate();
    this.persist();
    this.refresh();
  }

  freshSample(): SampleDraft {
    const c = this.lab.case;
    return {
      kind: "standard",
      levels: Object.fromEntries(c.analytes.map((id) => [id, 50])),
      prep: 1,
      mg: c.product.prepMg,
      ml: c.product.prepMl,
      dilution: 1,
      spike: {},
      stressOn: false,
      stress: { agent: "heat", hours: 2, tempC: 80 },
      replicates: 1,
      diluentPct: Math.round(c.diluentPhi * 100),
    };
  }

  /** Start an empty notebook. */
  reset(caseId: string, seed: string, instrumentId: string, student: string): void {
    const c = this.catalog.cases.get(caseId);
    if (!c) return;
    const s = newSession(c, seed.trim().slice(0, 200) || "DEMO-0001", instrumentId);
    s.student = student;
    this.adopt(new Lab(this.catalog, s));
  }

  adopt(lab: Lab): void {
    this.lab = lab;
    const last = lab.session.runs[lab.session.runs.length - 1];
    this.method = structuredClone(last?.method ?? lab.case.defaultMethod);
    this.sample = this.freshSample();
    this.selectedRun = last?.id ?? null;
    this.overlayRun = null;
    this.selectedPeak = null;
    this.fitRuns.clear();
    this.fitT0 = null;
    this.fitPlates = 10000;
    this.map = { ...DEFAULT_MAP };
    this.compare = { runs: new Set(), touched: false, by: "run", spacing: 0.5, normalise: false };
    this.persist();
  }

  importSession(text: string): void {
    this.adopt(new Lab(this.catalog, loadSession(text, this.catalog)));
  }

  exportSession(): string {
    return saveSession(this.lab.session);
  }

  persist(): void {
    try {
      localStorage.setItem(STORE_KEY, saveSession(this.lab.session));
      this.stored = true;
    } catch {
      // Storage unavailable or full: the notebook lives in memory and can still be downloaded.
      this.stored = false;
    }
  }

  /** The sample the bench draft describes. */
  specFromDraft(): SampleSpec {
    const d = this.sample;
    const stress = d.stressOn ? { stress: { ...d.stress } } : {};
    if (d.kind === "blank") return { kind: "blank" };
    if (d.kind === "standard") return { kind: "standard", levels: { ...d.levels }, prep: d.prep, ...stress };
    const spike = Object.fromEntries(Object.entries(d.spike).filter(([, v]) => v > 0));
    return { kind: "unknown", prep: d.prep, mg: d.mg, ml: d.ml, dilution: d.dilution, ...(Object.keys(spike).length ? { spike } : {}), ...stress };
  }

  inject(): void {
    try {
      let last = null;
      for (let i = 0; i < Math.max(1, Math.min(10, Math.round(this.sample.replicates))); i++) {
        last = this.lab.inject(this.method, this.specFromDraft(), this.sample.diluentPct / 100);
      }
      if (last) {
        this.selectedRun = last.id;
        this.selectedPeak = null;
        const warnings = this.lab.execute(last).result.warnings;
        this.message = warnings.length ? { kind: "bad", text: warnings.join(" ") } : { kind: "ok", text: `Injection ${last.id} complete.` };
      }
      this.persist();
    } catch (e) {
      this.message = { kind: "bad", text: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Id of the run whose method quantitation, suitability and validation refer to: the chosen one, or the latest. */
  refRunId(): number | null {
    const runs = this.lab.session.runs;
    const chosen = this.analysis.refRun;
    if (chosen !== null && runs.some((r) => r.id === chosen)) return chosen;
    return runs[runs.length - 1]?.id ?? null;
  }

  refMethod(): Method | null {
    const id = this.refRunId();
    return this.lab.session.runs.find((r) => r.id === id)?.method ?? null;
  }

  /** Calibration points the student left out, as "soluteId|runId". */
  excluded(): ReadonlySet<string> {
    return new Set(this.analysis.excluded);
  }

  soluteName(id: string): string {
    if (id.startsWith("unk")) return `Unknown ${id.slice(3).toUpperCase()}`;
    return this.catalog.solutes.get(id)?.abbr ?? id;
  }

  register(id: TabId, view: (app: App) => HTMLElement): void {
    this.views.set(id, view);
  }

  go(tab: TabId): void {
    this.tab = tab;
    this.message = null;
    try {
      if (location.hash.slice(1) !== tab) history.replaceState(null, "", `#${tab}`);
    } catch {
      // Sandboxed frames may forbid history changes.
    }
    this.render();
    window.scrollTo({ top: 0 });
    document.getElementById(`tab-${tab}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    document.getElementById("main")?.focus({ preventScroll: true });
  }

  /** Ask for a redraw. Coalesced, and held back while a pointer is down (see the constructor). */
  refresh(): void {
    this.pending = true;
    if (this.pointerDown || this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (!this.pointerDown) this.render();
    }, 0);
  }

  /** Redraw now. */
  render(): void {
    this.pending = false;
    const main = document.getElementById("main");
    const tablist = document.getElementById("tablist");
    if (!main || !tablist) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.id : "";
    const scroll = window.scrollY;
    const detailsKey = (d: HTMLDetailsElement): string => `${this.tab}|${d.querySelector("summary")?.textContent ?? ""}`;
    main.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => {
      if (d.open) this.openDetails.add(detailsKey(d));
      else this.openDetails.delete(detailsKey(d));
    });
    resetIds();
    clear(tablist);
    TABS.forEach((t, i) => {
      const selected = t.id === this.tab;
      const b = h("button", { role: "tab", type: "button", id: `tab-${t.id}`, "aria-selected": String(selected), "aria-controls": "main", tabindex: selected ? 0 : -1, onClick: () => this.go(t.id) }, t.label);
      b.addEventListener("keydown", (e) => {
        const to = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
        if (to < 0) return;
        e.preventDefault();
        const next = TABS[to]!;
        this.go(next.id);
        document.getElementById(`tab-${next.id}`)?.focus();
      });
      tablist.appendChild(b);
    });
    clear(main);
    main.setAttribute("aria-labelledby", `tab-${this.tab}`);
    try {
      const view = this.views.get(this.tab);
      if (view) main.appendChild(view(this));
      const l = this.lab.ledger();
      const ledger = document.getElementById("ledger");
      if (ledger) ledger.textContent = `${l.injections} injection${l.injections === 1 ? "" : "s"} | ${(l.minutes / 60).toFixed(1)} h instrument time | ${l.solventMl.toFixed(0)} mL solvent${this.stored ? "" : " | not saved in this browser: download the notebook"}`;
    } catch (e) {
      clear(main);
      main.appendChild(h("div", { class: "panel note bad", role: "alert" }, `This view could not be drawn: ${e instanceof Error ? e.message : String(e)}`));
    }
    // Wide tables scroll sideways inside their own box; make each box reachable by keyboard.
    main.querySelectorAll<HTMLElement>(".scroll, .eq").forEach((el, i) => {
      el.tabIndex = 0;
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", el.querySelector("caption")?.textContent ?? `Table ${i + 1}, scrolls sideways`);
    });
    // Panels the viewer opened stay open across redraws.
    main.querySelectorAll<HTMLDetailsElement>("details").forEach((d) => {
      if (this.openDetails.has(detailsKey(d))) d.open = true;
    });
    // Every control gets a stable id from what it is, so focus can be put back after a redraw.
    const seen = new Map<string, number>();
    main.querySelectorAll<HTMLElement>("button, select, input, textarea, summary, canvas, [tabindex]").forEach((el) => {
      if (el.id) return;
      const base = `${el.tagName.toLowerCase()}-${slug(el.getAttribute("aria-label") ?? el.textContent ?? "")}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      el.id = n ? `${base}-${n}` : base;
    });
    // Announce the outcome of the last action from a region that is not rebuilt.
    const live = document.getElementById("live");
    const text = this.message?.text ?? "";
    if (live && live.textContent !== text) live.textContent = text;
    if (active) document.getElementById(active)?.focus({ preventScroll: true });
    window.scrollTo({ top: scroll });
    if (active && document.activeElement === document.body) main.focus({ preventScroll: true });
  }
}
