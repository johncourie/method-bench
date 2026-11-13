// A generic liquid chromatograph that can be operated: solvent tray, pump,
// autosampler, column oven, detector. It is a picture of the class of instrument,
// not of any maker's product: the shapes, colours and panel layouts are this
// project's own. Knobs turn, buttons press, vials are chosen from the tray.
// Front-panel displays show what an operator can see (flow, % B, pressure,
// temperature, detector reading). Nothing inside the column is shown.
//
// The drawing never owns a setting. Every control reports to a handler, the
// handler changes the method, and the drawing is redrawn from the result. The
// form beside it changes the same method, so the two cannot disagree.

import type * as Three from "three";
import { drawText, loadThree, reducedMotion, textCanvas, type ThreeModule } from "./common.ts";

export type ModuleId = "pump" | "sampler" | "oven" | "detector" | "solvents";
export type KnobId = "flow" | "bStart" | "bEnd" | "gradTime" | "inj" | "temp" | "detect" | "ph";
export type ButtonId = "inject" | "vial-blank" | "vial-standard" | "vial-unknown" | "col-prev" | "col-next" | "det-mode" | "buffer-next";

export interface Readout {
  flow: number;
  pctB: number;
  /** End of the gradient, or null when the method is isocratic. */
  pctBEnd: number | null;
  gradMin: number | null;
  pressure: number;
  pressureLimit: number;
  tempC: number;
  injUl: number;
  vial: "blank" | "standard" | "unknown";
  sample: string;
  column: { name: string; lengthMm: number; idMm: number; index: number; count: number };
  detectorKind: "uv" | "ms";
  /** Wavelength in nm, or selected ion m/z. */
  detectorValue: number;
  detector: string;
  signal: string;
  /** Solvent A: its pH, its buffer, and whether that buffer holds that pH. */
  pH: number;
  buffer: string;
  bufferHolds: boolean;
  /** Solvent B. */
  organic: string;
}

/** One moment of a run being replayed on the panels. */
export interface Frame {
  t: number;
  pctB: number;
  pressure: number;
  signal: string;
}

export interface Handlers {
  /** Turn a knob by a number of detents (negative turns it down). Returns the new state. */
  turn(knob: KnobId, detents: number): Readout;
  /** Press a button. Returns the new state. */
  press(button: ButtonId): Readout;
  /** A knob was released or a button pressed: time to refresh the form. */
  settled(): void;
}

interface Panel {
  canvas: HTMLCanvasElement;
  texture: Three.CanvasTexture;
}

interface Knob {
  id: KnobId;
  spin: Three.Group;
  lo: number;
  hi: number;
  value: (r: Readout) => number | null;
  title: string;
}

const MODULES: Array<{ id: ModuleId; label: string; height: number }> = [
  { id: "pump", label: "PUMP", height: 1.25 },
  { id: "sampler", label: "AUTOSAMPLER", height: 1.45 },
  { id: "oven", label: "COLUMN OVEN", height: 1.45 },
  { id: "detector", label: "DETECTOR", height: 1.15 },
  { id: "solvents", label: "SOLVENTS", height: 1.0 },
];
const W = 4.4;
const D = 3;
const FRONT = D / 2 + 0.012;
const SWEEP = (3 * Math.PI) / 4; // a knob turns 135 degrees either side of straight up

export class Bench {
  readonly el: HTMLDivElement;
  private renderer: Three.WebGLRenderer;
  private scene: Three.Scene;
  private camera: Three.PerspectiveCamera;
  private panels = new Map<ModuleId, Panel>();
  private bodies = new Map<Three.Object3D, ModuleId>();
  private knobs = new Map<Three.Object3D, Knob>();
  private buttons = new Map<Three.Object3D, { id: ButtonId; title: string }>();
  private vials = new Map<Readout["vial"], Three.MeshStandardMaterial>();
  private centre = new Map<ModuleId, number>();
  private column: Three.Mesh | null = null;
  private readout: Readout | null = null;
  private playing: number | null = null;
  private focus: ModuleId | null = null;
  private fly: number | null = null;
  private goal = { pos: [0, 0, 0] as [number, number, number], look: [0, 0, 0] as [number, number, number] };
  private look: [number, number, number] = [0.4, 3, 0];

  private constructor(
    private T: ThreeModule,
    private handlers: Handlers,
  ) {
    this.el = document.createElement("div");
    this.el.className = "bench3d";
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const cv = this.renderer.domElement;
    cv.setAttribute("role", "img");
    this.el.appendChild(cv);
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
    this.scene.add(new T.HemisphereLight(0xffffff, 0x8a8f98, 1.6));
    const sun = new T.DirectionalLight(0xffffff, 1.4);
    sun.position.set(5, 9, 7);
    this.scene.add(sun);
    this.build();
    this.frame(null, true);
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.listen(cv);
  }

  static async create(handlers: Handlers): Promise<Bench> {
    return new Bench(await loadThree(), handlers);
  }

  // ------------------------------------------------------------------ construction

  private label(text: string, x: number, y: number, w = 0.5, h = 0.13): void {
    const T = this.T;
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: new T.CanvasTexture(textCanvas([text], { w: Math.round(w * 400), h: Math.round(h * 400), bg: "#d4d8dd", fg: "#14181f", font: `700 ${Math.round(h * 300)}px system-ui, sans-serif`, align: "center" })) }));
    m.position.set(x, y, FRONT);
    this.scene.add(m);
  }

  private knob(id: KnobId, x: number, y: number, name: string, lo: number, hi: number, value: Knob["value"], title: string): void {
    const T = this.T;
    const spin = new T.Group();
    spin.position.set(x, y, FRONT);
    const cap = new T.Mesh(new T.CylinderGeometry(0.17, 0.19, 0.12, 28), new T.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.45 }));
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.06;
    const notch = new T.Mesh(new T.BoxGeometry(0.035, 0.13, 0.02), new T.MeshBasicMaterial({ color: 0xf4b223 }));
    notch.position.set(0, 0.1, 0.125);
    spin.add(cap, notch);
    this.scene.add(spin);
    // A larger unseen disc makes the knob easy to catch.
    const target = new T.Mesh(new T.CircleGeometry(0.26, 20), new T.MeshBasicMaterial({ visible: false }));
    target.position.set(x, y, FRONT + 0.13);
    this.scene.add(target);
    this.knobs.set(target, { id, spin, lo, hi, value, title });
    this.label(name, x, y - 0.3);
  }

  private button(id: ButtonId, x: number, y: number, w: number, h: number, text: string, title: string, colour = 0x3a4048): void {
    const T = this.T;
    const b = new T.Mesh(new T.BoxGeometry(w, h, 0.07), new T.MeshStandardMaterial({ color: colour, roughness: 0.5 }));
    b.position.set(x, y, FRONT + 0.03);
    const face = new T.Mesh(new T.PlaneGeometry(w * 0.92, h * 0.8), new T.MeshBasicMaterial({ transparent: true, map: new T.CanvasTexture(textCanvas([text], { w: Math.round(w * 400), h: Math.round(h * 340), bg: "rgba(0,0,0,0)", fg: "#ffffff", font: `700 ${Math.round(h * 200)}px system-ui, sans-serif`, align: "center" })) }));
    face.position.set(x, y, FRONT + 0.07);
    this.scene.add(b, face);
    this.buttons.set(b, { id, title });
    this.buttons.set(face, { id, title });
  }

  private build(): void {
    const T = this.T;
    const body = new T.MeshStandardMaterial({ color: 0xd4d8dd, roughness: 0.75, metalness: 0.05 });
    const accent = new T.MeshStandardMaterial({ color: 0x0b5a7a, roughness: 0.6 });
    const dark = new T.MeshStandardMaterial({ color: 0x23282e, roughness: 0.5 });
    const steel = new T.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.3, metalness: 0.8 });
    const L = -W / 2;
    let y = 0;
    for (const m of MODULES) {
      const box = new T.Mesh(new T.BoxGeometry(W, m.height - 0.06, D), body);
      box.position.set(0, y + m.height / 2, 0);
      this.scene.add(box);
      this.bodies.set(box, m.id);
      this.centre.set(m.id, y + m.height / 2);
      const stripe = new T.Mesh(new T.BoxGeometry(W, 0.05, 0.02), accent);
      stripe.position.set(0, y + m.height - 0.1, FRONT);
      this.scene.add(stripe);
      this.label(m.label, L + 0.75, y + m.height - 0.25, 1.3, 0.16);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 176;
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      const screen = new T.Mesh(new T.PlaneGeometry(1.75, 0.6), new T.MeshBasicMaterial({ map: texture }));
      screen.position.set(W / 2 - 1.0, y + 0.45, FRONT);
      this.scene.add(screen);
      this.bodies.set(screen, m.id);
      this.panels.set(m.id, { canvas, texture });
      const ky = y + 0.55;

      if (m.id === "pump") {
        this.knob("flow", L + 0.35, ky, "FLOW", 0, 2, (r) => r.flow, "Flow rate");
        this.knob("bStart", L + 0.9, ky, "%B START", 0, 100, (r) => r.pctB, "Starting % B");
        this.knob("bEnd", L + 1.45, ky, "%B END", 0, 100, (r) => r.pctBEnd, "% B at the end of the gradient");
        this.knob("gradTime", L + 2.0, ky, "GRAD MIN", 0, 60, (r) => r.gradMin, "Gradient time");
      }
      if (m.id === "sampler") {
        const win = new T.Mesh(new T.PlaneGeometry(1.25, 0.62), dark);
        win.position.set(L + 0.75, y + 0.62, FRONT);
        this.scene.add(win);
        (["blank", "standard", "unknown"] as const).forEach((kind, i) => {
          const x = L + 0.35 + i * 0.4;
          const glass = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.36, 16), new T.MeshStandardMaterial({ color: 0xcfe6f0, transparent: true, opacity: 0.85, roughness: 0.2 }));
          glass.position.set(x, y + 0.58, FRONT + 0.11);
          const capMat = new T.MeshStandardMaterial({ color: 0x59616b, emissive: 0x000000 });
          const cap = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.08, 16), capMat);
          cap.position.set(x, y + 0.8, FRONT + 0.11);
          this.scene.add(glass, cap);
          this.vials.set(kind, capMat);
          const title = kind === "blank" ? "Blank" : kind === "standard" ? "Reference standard" : "Sample";
          this.buttons.set(glass, { id: `vial-${kind}`, title: `Vial: ${title}` });
          this.buttons.set(cap, { id: `vial-${kind}`, title: `Vial: ${title}` });
          this.label(kind === "blank" ? "BLANK" : kind === "standard" ? "STD" : "SAMPLE", x, y + 0.2, 0.36, 0.12);
        });
        this.knob("inj", L + 1.75, ky + 0.05, "INJ µL", 0, 20, (r) => r.injUl, "Injection volume");
        this.button("inject", L + 2.25, ky + 0.05, 0.42, 0.34, "INJECT", "Inject", 0x0b5a7a);
      }
      if (m.id === "oven") {
        const win = new T.Mesh(new T.PlaneGeometry(1.25, 0.42), dark);
        win.position.set(L + 0.75, y + 0.72, FRONT);
        this.scene.add(win);
        this.column = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1, 16), steel);
        this.column.rotation.z = Math.PI / 2;
        this.column.position.set(L + 0.75, y + 0.72, FRONT + 0.06);
        this.scene.add(this.column);
        this.button("col-prev", L + 0.45, y + 0.28, 0.42, 0.22, "‹ COL", "Previous column");
        this.button("col-next", L + 1.05, y + 0.28, 0.42, 0.22, "COL ›", "Next column");
        this.knob("temp", L + 1.9, ky + 0.05, "TEMP °C", 0, 100, (r) => r.tempC, "Column temperature");
      }
      if (m.id === "detector") {
        this.button("det-mode", L + 0.55, ky - 0.02, 0.62, 0.26, "UV / MS", "Switch between the UV and the mass detector");
        this.knob("detect", L + 1.55, ky, "nm | m/z", 0, 1, (r) => (r.detectorKind === "uv" ? (r.detectorValue - 200) / 200 : (r.detectorValue - 100) / 500), "Wavelength or selected ion");
      }
      if (m.id === "solvents") {
        this.knob("ph", L + 0.45, ky - 0.11, "pH OF A", 2, 8, (r) => r.pH, "pH of solvent A");
        this.button("buffer-next", L + 1.45, ky - 0.11, 0.8, 0.26, "BUFFER ›", "Change the buffer in solvent A");
      }
      y += m.height;
    }
    // Two reservoirs on the solvent module, and a waste bottle beside the stack.
    const bottle = (x: number, z: number, base: number, glass: number, liquid: number, text: string): void => {
      const g = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 1.1, 24), new T.MeshStandardMaterial({ color: glass, transparent: true, opacity: 0.35, roughness: 0.1 }));
      g.position.set(x, base + 0.55, z);
      const l = new T.Mesh(new T.CylinderGeometry(0.39, 0.39, 0.7, 24), new T.MeshStandardMaterial({ color: liquid, transparent: true, opacity: 0.7 }));
      l.position.set(x, base + 0.36, z);
      const cap = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.14, 16), accent);
      cap.position.set(x, base + 1.17, z);
      const tag = new T.Mesh(new T.PlaneGeometry(0.62, 0.3), new T.MeshBasicMaterial({ map: new T.CanvasTexture(textCanvas([text], { w: 256, h: 124, bg: "#ffffff", fg: "#14181f", font: "700 84px system-ui, sans-serif", align: "center" })) }));
      tag.position.set(x, base + 0.5, z + 0.43);
      this.scene.add(l, g, cap, tag);
      // Selecting a reservoir looks at the solvent module, where its controls are.
      if (text !== "WASTE") for (const part of [g, l, tag]) this.bodies.set(part, "solvents");
    };
    bottle(-1, 0.4, y, 0xdff3ff, 0x9fd0ea, "A");
    bottle(0.9, 0.4, y, 0xe9d2a0, 0xf2e6c4, "B");
    bottle(W / 2 + 0.9, 0.6, 0, 0xdddddd, 0xc9c2a8, "WASTE");
    const table = new T.Mesh(new T.BoxGeometry(9, 0.1, 5), new T.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.9 }));
    table.position.set(0.6, -0.05, 0);
    this.scene.add(table);
  }

  // ------------------------------------------------------------------ pointer

  private listen(cv: HTMLCanvasElement): void {
    const T = this.T;
    const cast = (e: { clientX: number; clientY: number }, among: Iterable<Three.Object3D>): Three.Object3D | undefined => {
      const r = cv.getBoundingClientRect();
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      return ray.intersectObjects([...among], false)[0]?.object;
    };
    let down: { x: number; y: number; knob: Knob | null; carried: number; moved: boolean } | null = null;

    cv.addEventListener("pointerdown", (e) => {
      const hit = cast(e, this.knobs.keys());
      down = { x: e.clientX, y: e.clientY, knob: hit ? this.knobs.get(hit)! : null, carried: 0, moved: false };
      if (down.knob) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
      if (down?.knob) {
        // Right or up turns the knob up. Six pixels to a detent.
        const travel = (e.clientX - down.x - (e.clientY - down.y)) / 6;
        const detents = Math.trunc(travel - down.carried);
        if (detents !== 0) {
          down.carried += detents;
          down.moved = true;
          this.update(this.handlers.turn(down.knob.id, detents));
        }
        return;
      }
      const k = cast(e, this.knobs.keys());
      const b = k ? undefined : cast(e, this.buttons.keys());
      const m = k || b ? undefined : cast(e, this.bodies.keys());
      cv.style.cursor = k ? "ew-resize" : b || m ? "pointer" : "default";
      cv.title = k ? `${this.knobs.get(k)!.title}: drag sideways or scroll to change` : b ? this.buttons.get(b)!.title : m && !this.focus ? "Select to look closer" : "";
    });
    cv.addEventListener("pointerup", (e) => {
      const d = down;
      down = null;
      if (!d) return;
      if (d.knob) {
        if (d.moved) this.handlers.settled();
        return;
      }
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      const b = cast(e, this.buttons.keys());
      if (b) {
        this.update(this.handlers.press(this.buttons.get(b)!.id));
        this.handlers.settled();
        return;
      }
      const m = cast(e, this.bodies.keys());
      this.frame(m ? this.bodies.get(m)! : null);
    });
    cv.addEventListener("pointercancel", () => { down = null; });
    let settle: number | null = null;
    cv.addEventListener(
      "wheel",
      (e) => {
        const hit = cast(e, this.knobs.keys());
        if (!hit) return; // let the page scroll
        e.preventDefault();
        this.update(this.handlers.turn(this.knobs.get(hit)!.id, e.deltaY < 0 ? 1 : -1));
        if (settle !== null) clearTimeout(settle);
        settle = window.setTimeout(() => this.handlers.settled(), 250);
      },
      { passive: false },
    );
  }

  // ------------------------------------------------------------------ camera

  /** Look at one module from close by, or at the whole instrument. */
  frame(module: ModuleId | null, instant = false): void {
    this.focus = module;
    const wide = this.camera.aspect || 1.6;
    if (module) {
      const y = this.centre.get(module)!;
      // Close enough for the module's face to fill the width of the view.
      const dist = (W / 2 + 0.25) / (Math.tan((this.camera.fov * Math.PI) / 360) * wide) + D / 2;
      this.goal = { pos: [0, y + 0.1, Math.max(4.2, dist)], look: [0, y, 0] };
    } else {
      // Far enough back for the whole stack, reservoirs included, at any shape of view.
      const pull = Math.max(1, 1.9 / wide);
      this.goal = { pos: [6.0 * pull, 5.6, 15.4 * pull], look: [0.5, 3.75, 0] };
    }
    this.el.dispatchEvent(new CustomEvent("framed", { detail: module }));
    if (this.fly !== null) cancelAnimationFrame(this.fly);
    this.fly = null;
    if (instant || reducedMotion()) {
      this.camera.position.set(...this.goal.pos);
      this.look = [...this.goal.look];
      this.camera.lookAt(...this.look);
      this.draw();
      return;
    }
    const from = { pos: this.camera.position.toArray() as [number, number, number], look: [...this.look] as [number, number, number] };
    const start = performance.now();
    const step = (now: number): void => {
      const u = Math.min(1, (now - start) / 260);
      const e = u * u * (3 - 2 * u);
      const mix = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
      this.camera.position.set(...mix(from.pos, this.goal.pos));
      this.look = mix(from.look, this.goal.look);
      this.camera.lookAt(...this.look);
      this.draw();
      this.fly = u < 1 ? requestAnimationFrame(step) : null;
    };
    this.fly = requestAnimationFrame(step);
  }

  /** Where a control is on the page, in client pixels. Used by tests, and useful for pointing at a control. */
  locate(id: KnobId | ButtonId): { x: number; y: number } | null {
    const all: Array<[Three.Object3D, string]> = [...[...this.knobs].map(([o, k]) => [o, k.id] as [Three.Object3D, string]), ...[...this.buttons].map(([o, b]) => [o, b.id] as [Three.Object3D, string])];
    const hit = all.find(([, name]) => name === id)?.[0];
    if (!hit) return null;
    const p = hit.getWorldPosition(new this.T.Vector3()).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  get focused(): ModuleId | null {
    return this.focus;
  }

  private resize(): void {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame(this.focus, true);
  }

  // ------------------------------------------------------------------ state

  /** Show the instrument's present settings and reading. */
  update(r: Readout): void {
    this.readout = r;
    if (this.playing === null) this.paint(r, null);
    for (const k of this.knobs.values()) {
      const v = k.value(r);
      const f = v === null ? 0 : Math.min(1, Math.max(0, (v - k.lo) / (k.hi - k.lo)));
      k.spin.rotation.z = SWEEP - 2 * SWEEP * f;
    }
    for (const [kind, mat] of this.vials) mat.emissive.set(kind === r.vial ? 0xf4b223 : 0x000000);
    // The column in the oven window is drawn to its real proportions.
    if (this.column) {
      const thick = Math.min(2.2, Math.max(0.6, r.column.idMm / 3));
      this.column.scale.set(thick, Math.min(1.15, Math.max(0.3, r.column.lengthMm / 220)), thick);
    }
    this.renderer.domElement.setAttribute(
      "aria-label",
      `Drawing of a generic liquid chromatograph that can be operated with a pointer: solvent reservoirs A and B, pump at ${r.flow} mL/min and ${r.pctB.toFixed(0)}% B, autosampler set to ${r.injUl} µL, column oven at ${r.tempC} °C holding the ${r.column.name} column, and the detector at ${r.detector}. Solvent A is ${r.buffer.toLowerCase()} at pH ${r.pH}. Every control on it is also in the form below.`,
    );
    this.draw();
  }

  private paint(r: Readout, f: Frame | null): void {
    const bg = "#0d1a14";
    const fg = "#9df0b8";
    const warn = "#ffb36b";
    const p = f?.pressure ?? r.pressure;
    const set = (id: ModuleId, lines: string[], colour = fg): void => {
      const panel = this.panels.get(id);
      if (!panel) return;
      drawText(panel.canvas, lines, { bg, fg: colour });
      panel.texture.needsUpdate = true;
    };
    const programme = r.pctBEnd === null || r.gradMin === null ? "isocratic" : `to ${r.pctBEnd.toFixed(0)}% in ${r.gradMin.toFixed(1)} min`;
    set("pump", [`${r.flow.toFixed(2)} mL/min  ${(f?.pctB ?? r.pctB).toFixed(1)} %B`, f ? `RUN ${f.t.toFixed(1)} min` : programme, `${p.toFixed(0)} of ${r.pressureLimit.toFixed(0)} bar`], p > r.pressureLimit ? warn : fg);
    set("sampler", [`INJ ${r.injUl} µL`, r.sample.slice(0, 20)]);
    set("oven", [`${r.tempC.toFixed(1)} °C`, `${r.column.lengthMm} x ${r.column.idMm} mm`, `COLUMN ${r.column.index + 1} OF ${r.column.count}`]);
    set("detector", [r.detector, f?.signal ?? r.signal]);
    set("solvents", [`A ${r.buffer} pH ${r.pH.toFixed(2)}`, r.bufferHolds ? `B ${r.organic}` : "pH OUTSIDE BUFFER RANGE"], r.bufferHolds ? fg : warn);
  }

  /** Replay a finished run on the front panels over a few seconds. */
  play(frames: readonly Frame[]): void {
    if (this.playing !== null) cancelAnimationFrame(this.playing);
    this.playing = null;
    if (!this.readout || frames.length === 0 || reducedMotion()) return;
    const start = performance.now();
    const step = (now: number): void => {
      const u = (now - start) / 4000;
      if (u >= 1 || !this.readout || !this.el.isConnected) {
        this.playing = null;
        if (this.readout) this.paint(this.readout, null);
        this.draw();
        return;
      }
      this.paint(this.readout, frames[Math.min(frames.length - 1, Math.floor(u * frames.length))]!);
      this.draw();
      this.playing = requestAnimationFrame(step);
    };
    this.playing = requestAnimationFrame(step);
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
