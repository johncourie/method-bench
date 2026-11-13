// A generic liquid chromatograph, drawn as a stack of modules: solvent tray, pump,
// autosampler, column oven, detector. It is a picture of the class of instrument,
// not of any maker's product: the shapes, colours and panel layouts are this
// project's own. Front-panel displays show what an operator can see (flow, % B,
// pressure, temperature, detector reading). Nothing inside the column is shown.

import type * as Three from "three";
import { drawText, loadThree, reducedMotion, textCanvas, token, type ThreeModule } from "./common.ts";

export type ModuleId = "pump" | "sampler" | "oven" | "detector";

export interface Readout {
  flow: number;
  pctB: number;
  pressure: number;
  pressureLimit: number;
  tempC: number;
  injUl: number;
  sample: string;
  column: { name: string; lengthMm: number; idMm: number };
  detector: string;
  signal: string;
  status: string;
}

/** One moment of a run being replayed on the panels. */
export interface Frame {
  t: number;
  pctB: number;
  pressure: number;
  signal: string;
}

interface Panel {
  canvas: HTMLCanvasElement;
  texture: Three.CanvasTexture;
}

const MODULES: Array<{ id: ModuleId; label: string; height: number }> = [
  { id: "pump", label: "PUMP", height: 0.9 },
  { id: "sampler", label: "AUTOSAMPLER", height: 1.3 },
  { id: "oven", label: "COLUMN OVEN", height: 1.4 },
  { id: "detector", label: "DETECTOR", height: 0.9 },
];
const W = 4.2;
const D = 3;

export class Bench {
  readonly el: HTMLDivElement;
  private renderer: Three.WebGLRenderer;
  private scene: Three.Scene;
  private camera: Three.PerspectiveCamera;
  private panels = new Map<ModuleId, Panel>();
  private bodies = new Map<Three.Object3D, ModuleId>();
  private column: Three.Mesh | null = null;
  private bodyMaterial: Three.MeshStandardMaterial;
  private readout: Readout | null = null;
  private playing: number | null = null;
  private dirty = true;

  private constructor(
    private T: ThreeModule,
    private onPick: (m: ModuleId) => void,
  ) {
    const T3 = T;
    this.el = document.createElement("div");
    this.el.className = "bench3d";
    this.renderer = new T3.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const cv = this.renderer.domElement;
    cv.setAttribute("role", "img");
    this.el.appendChild(cv);
    this.scene = new T3.Scene();
    this.camera = new T3.PerspectiveCamera(32, 1, 0.1, 100);
    this.camera.position.set(6.2, 4.6, 10.5);
    this.camera.lookAt(0.4, 2.7, 0);
    this.scene.add(new T3.HemisphereLight(0xffffff, 0x8a8f98, 1.6));
    const sun = new T3.DirectionalLight(0xffffff, 1.4);
    sun.position.set(5, 9, 7);
    this.scene.add(sun);
    this.bodyMaterial = new T3.MeshStandardMaterial({ color: 0xd4d8dd, roughness: 0.75, metalness: 0.05 });
    this.build();
    new ResizeObserver(() => this.resize()).observe(this.el);

    let down: { x: number; y: number } | null = null;
    cv.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = cv.getBoundingClientRect();
      const ray = new T3.Raycaster();
      ray.setFromCamera(new T3.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      for (const hit of ray.intersectObjects([...this.bodies.keys()], false)) {
        const id = this.bodies.get(hit.object);
        if (id) {
          this.onPick(id);
          return;
        }
      }
    });
    cv.addEventListener("pointermove", (e) => {
      const r = cv.getBoundingClientRect();
      const ray = new T3.Raycaster();
      ray.setFromCamera(new T3.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      cv.style.cursor = ray.intersectObjects([...this.bodies.keys()], false).length ? "pointer" : "default";
    });
  }

  static async create(onPick: (m: ModuleId) => void): Promise<Bench> {
    return new Bench(await loadThree(), onPick);
  }

  private build(): void {
    const T = this.T;
    const accent = new T.MeshStandardMaterial({ color: 0x0b5a7a, roughness: 0.6 });
    const dark = new T.MeshStandardMaterial({ color: 0x23282e, roughness: 0.5 });
    const steel = new T.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.3, metalness: 0.8 });
    let y = 0;
    for (const m of MODULES) {
      const body = new T.Mesh(new T.BoxGeometry(W, m.height - 0.06, D), this.bodyMaterial);
      body.position.set(0, y + m.height / 2, 0);
      this.scene.add(body);
      this.bodies.set(body, m.id);
      // A thin stripe and a name plate identify the module; the display sits beside them.
      const stripe = new T.Mesh(new T.BoxGeometry(W, 0.05, 0.02), accent);
      stripe.position.set(0, y + m.height - 0.12, D / 2 + 0.011);
      this.scene.add(stripe);
      const plate = new T.Mesh(new T.PlaneGeometry(1.6, 0.22), new T.MeshBasicMaterial({ map: new T.CanvasTexture(textCanvas([m.label], { w: 512, h: 70, bg: "#eef0f2", fg: "#14181f", font: "700 44px system-ui, sans-serif" })) }));
      plate.position.set(-W / 2 + 0.95, y + m.height - 0.28, D / 2 + 0.012);
      this.scene.add(plate);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 160;
      const texture = new T.CanvasTexture(canvas);
      texture.colorSpace = T.SRGBColorSpace;
      const screen = new T.Mesh(new T.PlaneGeometry(1.9, 0.6), new T.MeshBasicMaterial({ map: texture }));
      screen.position.set(W / 2 - 1.15, y + Math.min(m.height / 2, 0.42), D / 2 + 0.012);
      this.scene.add(screen);
      this.bodies.set(screen, m.id);
      this.panels.set(m.id, { canvas, texture });
      if (m.id === "sampler") {
        // Vial tray behind a dark window.
        const win = new T.Mesh(new T.PlaneGeometry(1.5, 0.62), dark);
        win.position.set(-W / 2 + 0.95, y + 0.48, D / 2 + 0.012);
        this.scene.add(win);
        for (let i = 0; i < 6; i++) {
          const vial = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.3, 12), new T.MeshStandardMaterial({ color: 0xcfe6f0, transparent: true, opacity: 0.85, roughness: 0.2 }));
          vial.position.set(-W / 2 + 0.38 + i * 0.23, y + 0.42, D / 2 + 0.06);
          this.scene.add(vial);
        }
      }
      if (m.id === "oven") {
        const win = new T.Mesh(new T.PlaneGeometry(1.7, 0.5), dark);
        win.position.set(-W / 2 + 1.05, y + 0.5, D / 2 + 0.012);
        this.scene.add(win);
        this.column = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 1, 16), steel);
        this.column.rotation.z = Math.PI / 2;
        this.column.position.set(-W / 2 + 1.05, y + 0.5, D / 2 + 0.07);
        this.scene.add(this.column);
      }
      y += m.height;
    }
    // Solvent tray with two reservoirs, and a waste bottle beside the stack.
    const tray = new T.Mesh(new T.BoxGeometry(W, 0.12, D), this.bodyMaterial);
    tray.position.set(0, y + 0.06, 0);
    this.scene.add(tray);
    const bottle = (x: number, z: number, base: number, glass: number, liquid: number, label: string): void => {
      const g = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 1.1, 24), new T.MeshStandardMaterial({ color: glass, transparent: true, opacity: 0.35, roughness: 0.1 }));
      g.position.set(x, base + 0.55, z);
      const l = new T.Mesh(new T.CylinderGeometry(0.39, 0.39, 0.7, 24), new T.MeshStandardMaterial({ color: liquid, transparent: true, opacity: 0.7 }));
      l.position.set(x, base + 0.36, z);
      const cap = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.14, 16), accent);
      cap.position.set(x, base + 1.17, z);
      const tag = new T.Mesh(new T.PlaneGeometry(0.62, 0.3), new T.MeshBasicMaterial({ map: new T.CanvasTexture(textCanvas([label], { w: 256, h: 124, bg: "#ffffff", fg: "#14181f", font: "700 84px system-ui, sans-serif", align: "center" })) }));
      tag.position.set(x, base + 0.5, z + 0.43);
      this.scene.add(l, g, cap, tag);
    };
    bottle(-1, 0.4, y + 0.12, 0xdff3ff, 0x9fd0ea, "A");
    bottle(0.9, 0.4, y + 0.12, 0xe9d2a0, 0xf2e6c4, "B");
    bottle(W / 2 + 0.9, 0.6, 0, 0xdddddd, 0xc9c2a8, "WASTE");
    const bench = new T.Mesh(new T.BoxGeometry(9, 0.1, 5), new T.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.9 }));
    bench.position.set(0.6, -0.05, 0);
    this.scene.add(bench);
  }

  private resize(): void {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back on narrow layouts so the whole stack stays in view.
    const pull = Math.max(1, 1.25 / this.camera.aspect);
    this.camera.position.set(6.2 * pull, 4.6, 10.5 * pull);
    this.camera.lookAt(0.4, 2.7, 0);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.draw();
  }

  /** Show the instrument's present settings and reading. */
  update(r: Readout): void {
    this.readout = r;
    if (this.playing === null) this.paint(r, null);
    // The column in the oven window is drawn to its real proportions.
    if (this.column) {
      this.column.scale.set(Math.min(2.2, Math.max(0.6, r.column.idMm / 3)), Math.min(1.6, Math.max(0.35, r.column.lengthMm / 180)), Math.min(2.2, Math.max(0.6, r.column.idMm / 3)));
    }
    this.bodyMaterial.color.set(token("--panel", "#ffffff") === "#1b2027" ? 0x59616b : 0xd4d8dd);
    this.renderer.domElement.setAttribute("aria-label", `Drawing of a generic liquid chromatograph: solvent reservoirs A and B, pump at ${r.flow} mL/min and ${r.pctB.toFixed(0)}% B, autosampler set to ${r.injUl} µL, column oven at ${r.tempC} °C holding the ${r.column.name} column, and the detector. The same settings are in the form beside it.`);
    this.dirty = true;
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
    set("pump", [`${r.flow.toFixed(2)} mL/min   ${(f?.pctB ?? r.pctB).toFixed(1)} % B`, `${p.toFixed(0)} bar  (max ${r.pressureLimit.toFixed(0)})`], p > 0.9 * r.pressureLimit ? warn : fg);
    set("sampler", [`INJ ${r.injUl} µL`, f ? `RUN ${f.t.toFixed(1)} min` : r.sample.slice(0, 22)]);
    set("oven", [`${r.tempC.toFixed(1)} °C`, `${r.column.lengthMm} x ${r.column.idMm} mm`]);
    set("detector", [r.detector, f?.signal ?? r.signal]);
  }

  /** Replay a finished run on the front panels over a few seconds. */
  play(frames: readonly Frame[]): void {
    if (this.playing !== null) cancelAnimationFrame(this.playing);
    this.playing = null;
    if (!this.readout || frames.length === 0 || reducedMotion()) return;
    const start = performance.now();
    const seconds = 4;
    const step = (now: number): void => {
      const u = (now - start) / (seconds * 1000);
      if (u >= 1 || !this.readout || !this.el.isConnected) {
        this.playing = null;
        if (this.readout) this.paint(this.readout, null);
        this.dirty = true;
        this.draw();
        return;
      }
      this.paint(this.readout, frames[Math.min(frames.length - 1, Math.floor(u * frames.length))]!);
      this.dirty = true;
      this.draw();
      this.playing = requestAnimationFrame(step);
    };
    this.playing = requestAnimationFrame(step);
  }

  private draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  }
}
