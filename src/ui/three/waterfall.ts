// Run comparison: chromatograms drawn side by side in depth, coloured by a chosen
// variable. With no depth spacing it is a plain overlay; pulling the traces apart
// gives a waterfall that can be turned with the pointer or the arrow keys.
// Colour is never the only carrier: each trace has its run number at its start,
// and the table under the view lists every trace with its value.

import type * as Three from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Line2 } from "three/examples/jsm/lines/Line2.js";
import { loadThree, textCanvas, token, type ThreeModule } from "./common.ts";

export interface Trace {
  label: string;
  colour: string;
  time: ArrayLike<number>;
  signal: ArrayLike<number>;
}

export interface WaterfallOptions {
  /** Depth between traces, 0 (overlay) to 1. */
  spacing: number;
  /** Scale every trace to its own tallest peak. */
  normalise: boolean;
  /** Time window to show, min. */
  window: [number, number] | null;
  unit: string;
}

interface Extras {
  OrbitControls: typeof OrbitControls;
  Line2: typeof Line2;
  LineGeometry: typeof import("three/examples/jsm/lines/LineGeometry.js").LineGeometry;
  LineMaterial: typeof import("three/examples/jsm/lines/LineMaterial.js").LineMaterial;
}

const X = 10;
const Y = 4;
const Z = 6;

export class Waterfall {
  readonly el: HTMLDivElement;
  private renderer: Three.WebGLRenderer;
  private scene: Three.Scene;
  private camera: Three.PerspectiveCamera;
  private controls: OrbitControls;
  private group: Three.Group;
  private lastSpacing = -1;
  /** Aspect ratio the camera distance was last fitted to. */
  private fitted = 0;

  private constructor(
    private T: ThreeModule,
    private X3: Extras,
  ) {
    this.el = document.createElement("div");
    this.el.className = "bench3d waterfall";
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const cv = this.renderer.domElement;
    cv.tabIndex = 0;
    cv.setAttribute("role", "img");
    this.el.appendChild(cv);
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(30, 1, 0.1, 200);
    this.controls = new X3.OrbitControls(this.camera, cv);
    this.controls.enableDamping = false;
    this.controls.target.set(X / 2, Y / 2.4, -Z / 4);
    this.controls.addEventListener("change", () => this.draw());
    this.group = new T.Group();
    this.scene.add(this.group);
    this.view(0);
    new ResizeObserver(() => this.resize()).observe(this.el);
    // Keyboard: arrows turn the view, plus and minus zoom, 0 returns to the front.
    cv.addEventListener("keydown", (e) => {
      const step = 0.12;
      const offset = this.camera.position.clone().sub(this.controls.target);
      const s = new T.Spherical().setFromVector3(offset);
      if (e.key === "ArrowLeft") s.theta -= step;
      else if (e.key === "ArrowRight") s.theta += step;
      else if (e.key === "ArrowUp") s.phi = Math.max(0.2, s.phi - step);
      else if (e.key === "ArrowDown") s.phi = Math.min(Math.PI / 2, s.phi + step);
      else if (e.key === "+" || e.key === "=") s.radius *= 0.9;
      else if (e.key === "-") s.radius *= 1.1;
      else if (e.key === "0") {
        this.view(this.lastSpacing);
        e.preventDefault();
        return;
      } else return;
      e.preventDefault();
      this.camera.position.copy(this.controls.target).add(new T.Vector3().setFromSpherical(s));
      this.camera.lookAt(this.controls.target);
      this.draw();
    });
  }

  static async create(): Promise<Waterfall> {
    const [T, oc, l2, lg, lm] = await Promise.all([
      loadThree(),
      import("three/examples/jsm/controls/OrbitControls.js"),
      import("three/examples/jsm/lines/Line2.js"),
      import("three/examples/jsm/lines/LineGeometry.js"),
      import("three/examples/jsm/lines/LineMaterial.js"),
    ]);
    return new Waterfall(T, { OrbitControls: oc.OrbitControls, Line2: l2.Line2, LineGeometry: lg.LineGeometry, LineMaterial: lm.LineMaterial });
  }

  /** Front view for an overlay, a raised three-quarter view once the traces are spread in depth. */
  view(spacing: number): void {
    const s = Math.max(0, spacing);
    this.controls.target.set(X / 2, Y / 2.6, (-Z * s) / 2);
    // Far enough back for the whole plot, with its labels, to fit the frame.
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const dist = Math.max((Y / 2 + 1.3) / tan, (X / 2 + 1.2 + 2.2 * s) / (tan * Math.max(0.3, this.camera.aspect)));
    const dir = new this.T.Vector3(0.45 * s, 0.42 * s, 1).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.draw();
  }

  private resize(): void {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.lastSpacing >= 0 && Math.abs(this.camera.aspect - this.fitted) > 0.05) {
      this.fitted = this.camera.aspect;
      this.view(this.lastSpacing);
    }
    this.group.traverse((o) => {
      const m = (o as Line2).material as { resolution?: Three.Vector2 } | undefined;
      m?.resolution?.set(w, h);
    });
    this.draw();
  }

  set(traces: readonly Trace[], opts: WaterfallOptions): void {
    const T = this.T;
    // Dispose of the previous drawing.
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      const mesh = o as Three.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as Three.Material | Three.Material[] | undefined;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        (m as Three.MeshBasicMaterial).map?.dispose();
        m.dispose();
      }
    }
    const ink = token("--ink-muted", "#4a5361");
    const [t0, t1] = opts.window ?? [0, Math.max(1e-6, ...traces.map((t) => t.time[t.time.length - 1] ?? 0))];
    // Vertical scale: common, or per trace when normalised.
    const peak = (tr: Trace): number => {
      let m = 1e-9;
      for (let i = 0; i < tr.signal.length; i++) if (tr.time[i]! >= t0 && tr.time[i]! <= t1 && tr.signal[i]! > m) m = tr.signal[i]!;
      return m;
    };
    const common = Math.max(...traces.map(peak), 1e-9);
    const w = this.el.clientWidth || 800;
    const h = this.el.clientHeight || 400;
    const depth = traces.length > 1 ? (Z * opts.spacing) / (traces.length - 1) : 0;

    traces.forEach((tr, k) => {
      const top = opts.normalise ? peak(tr) : common;
      // Keep the lowest and highest sample in each of about 1500 columns, so no spike is lost.
      const pts: number[] = [];
      const cols = 1500;
      let col = -1;
      let lo = 0;
      let hi = 0;
      let first = true;
      const z = -k * depth;
      const flush = (): void => {
        if (col < 0) return;
        const x = (col / cols) * X;
        pts.push(x, (lo / top) * Y, z, x, (hi / top) * Y, z);
      };
      for (let i = 0; i < tr.time.length; i++) {
        const t = tr.time[i]!;
        if (t < t0 || t > t1) continue;
        const c = Math.floor(((t - t0) / (t1 - t0)) * cols);
        const y = Math.max(-0.05 * top, tr.signal[i]!);
        if (c !== col || first) {
          flush();
          col = c;
          lo = y;
          hi = y;
          first = false;
        } else {
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
      }
      flush();
      if (pts.length < 6) return;
      const geometry = new this.X3.LineGeometry();
      geometry.setPositions(pts);
      const material = new this.X3.LineMaterial({ color: new T.Color(tr.colour).getHex(), linewidth: 2.2, worldUnits: false });
      material.resolution.set(w, h);
      this.group.add(new this.X3.Line2(geometry, material));
      // Run number at the start of the trace, so identity does not rest on colour.
      this.group.add(this.sprite(tr.label, -0.4, 0.16, z, tr.colour, 0.42));
    });

    // Floor grid and time ticks.
    const grid: number[] = [];
    const back = -Math.max(0.001, depth * Math.max(0, traces.length - 1));
    const ticks = niceTicks(t0, t1, 6);
    for (const t of ticks) {
      const x = ((t - t0) / (t1 - t0)) * X;
      grid.push(x, 0, 0, x, 0, back);
      this.group.add(this.sprite(trim(t), x, -0.36, 0.25, ink, 0.36));
    }
    grid.push(0, 0, 0, X, 0, 0, 0, 0, back, X, 0, back, 0, 0, 0, 0, Y, 0);
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(grid, 3));
    this.group.add(new T.LineSegments(g, new T.LineBasicMaterial({ color: new T.Color(token("--rule", "#c9ced8")).getHex() })));
    this.group.add(this.sprite("Time, min", X / 2, -0.82, 0.25, ink, 0.38));
    this.group.add(this.sprite(opts.normalise ? "Each trace scaled to its tallest peak" : `Response, ${opts.unit}; top of axis ${trim(common)}`, 0.1, Y + 0.3, 0, ink, 0.34, "left"));

    this.renderer.domElement.setAttribute("aria-label", `${traces.length} chromatograms compared from ${trim(t0)} to ${trim(t1)} min, ${opts.spacing > 0 ? "spread in depth as a waterfall" : "overlaid"}. The table below lists each trace. Keys: arrows turn the view, plus and minus zoom, 0 returns to the front.`);
    if (Math.abs(opts.spacing - this.lastSpacing) > 1e-9) {
      this.lastSpacing = opts.spacing;
      this.view(opts.spacing);
    }
    this.resize();
  }

  private sprite(text: string, x: number, y: number, z: number, colour: string, size: number, align: "center" | "left" = "center"): Three.Sprite {
    const T = this.T;
    const wPx = Math.max(64, Math.min(1024, 30 * text.length));
    const canvas = textCanvas([text], { w: wPx, h: 64, bg: "rgba(0,0,0,0)", fg: colour, font: "600 40px system-ui, sans-serif", align: "center" });
    const map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    const s = new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthTest: false }));
    s.scale.set((size * wPx) / 64, size, 1);
    s.position.set(align === "left" ? x + (size * wPx) / 128 : x, y, z);
    return s;
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

function niceTicks(lo: number, hi: number, target: number): number[] {
  const raw = (hi - lo) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function trim(v: number): string {
  return Math.abs(v) >= 1000 ? v.toExponential(1) : String(Number(v.toPrecision(3)));
}
