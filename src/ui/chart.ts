// Canvas line chart for chromatograms, spectra and calibration plots.
// Every chart on screen is paired with a table that carries the same information
// as text; the canvas itself gets a short aria-label summary.

export interface Series {
  label: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Index into the series palette; also selects the dash pattern. */
  style?: number;
  /** Draw as unconnected points. */
  points?: boolean;
  /** Draw in the muted colour (baselines, fitted lines). */
  muted?: boolean;
}

export interface Marker {
  x: number;
  y: number;
  text: string;
}

export interface ChartSpec {
  series: Series[];
  xLabel: string;
  yLabel: string;
  markers?: Marker[];
  /** Vertical drop lines (peak boundaries). */
  drops?: Array<{ x: number; y0: number; y1: number }>;
  /** Shaded x intervals, for example a fitted range. */
  bands?: Array<[number, number]>;
  summary: string;
  /** Start with this x window instead of the full range. */
  xWindow?: [number, number];
  yFloorZero?: boolean;
}

const DASHES: number[][] = [[], [6, 3], [2, 3], [8, 3, 2, 3], [1, 2]];

function niceTicks(lo: number, hi: number, target: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function tickText(v: number, step: number): string {
  if (Math.abs(v) >= 1e5 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3)) return v.toExponential(1);
  const d = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
  return v.toFixed(d);
}

export class Chart {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private readout: HTMLElement;
  private spec: ChartSpec | null = null;
  private view: [number, number] | null = null;
  private full: [number, number] = [0, 1];
  private drag: { x0: number; x1: number } | null = null;
  private cursor: number | null = null;
  private plot = { l: 0, t: 0, w: 1, h: 1 };

  constructor(height = 300) {
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.style.height = `${height}px`;
    this.readout = document.createElement("div");
    this.readout.className = "chart-readout";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "small";
    reset.textContent = "Full view";
    reset.addEventListener("click", () => this.zoomTo(null));
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.append(this.readout, reset);
    this.el = document.createElement("div");
    this.el.className = "chart";
    this.el.append(this.canvas, bar);

    new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.canvas.addEventListener("pointerdown", (e) => {
      const x = this.toData(e.offsetX);
      this.drag = { x0: x, x1: x };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      const x = this.toData(e.offsetX);
      if (this.drag) this.drag.x1 = x;
      this.cursor = x;
      this.draw();
    });
    this.canvas.addEventListener("pointerup", () => {
      const d = this.drag;
      this.drag = null;
      if (d && Math.abs(d.x1 - d.x0) > (this.currentView()[1] - this.currentView()[0]) * 0.02) {
        this.zoomTo([Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)]);
      } else this.draw();
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.cursor = null;
      this.draw();
    });
    this.canvas.addEventListener("dblclick", () => this.zoomTo(null));
    this.canvas.addEventListener("keydown", (e) => {
      const [a, b] = this.currentView();
      const span = b - a;
      const mid = (a + b) / 2;
      let next: [number, number] | null | undefined;
      if (e.key === "+" || e.key === "=") next = [mid - span / 4, mid + span / 4];
      else if (e.key === "-") next = [mid - span, mid + span];
      else if (e.key === "ArrowLeft") next = [a - span / 5, b - span / 5];
      else if (e.key === "ArrowRight") next = [a + span / 5, b + span / 5];
      else if (e.key === "0" || e.key === "Escape") next = null;
      if (next === undefined) return;
      e.preventDefault();
      this.zoomTo(next);
    });
  }

  set(spec: ChartSpec): void {
    this.spec = spec;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of spec.series) {
      for (let i = 0; i < s.x.length; i++) {
        const v = s.x[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!(hi > lo)) {
      lo = 0;
      hi = 1;
    }
    this.full = [lo, hi];
    this.view = spec.xWindow ?? null;
    this.canvas.setAttribute("aria-label", `${spec.summary} Keys: plus and minus zoom, arrows pan, 0 resets.`);
    this.draw();
  }

  private currentView(): [number, number] {
    return this.view ?? this.full;
  }

  private zoomTo(v: [number, number] | null): void {
    if (v) {
      const lo = Math.max(this.full[0], v[0]);
      const hi = Math.min(this.full[1], v[1]);
      this.view = hi - lo > (this.full[1] - this.full[0]) * 1e-4 ? [lo, hi] : this.view;
      if (this.view && this.view[0] <= this.full[0] && this.view[1] >= this.full[1]) this.view = null;
    } else this.view = null;
    this.draw();
  }

  private toData(px: number): number {
    const [a, b] = this.currentView();
    return a + ((px - this.plot.l) / this.plot.w) * (b - a);
  }

  private draw(): void {
    const spec = this.spec;
    const cv = this.canvas;
    const ctx = cv.getContext("2d");
    if (!spec || !ctx) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (W === 0 || H === 0) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(cv);
    const col = (name: string): string => css.getPropertyValue(name).trim() || "#888";
    const ink = col("--ink");
    const mutedInk = col("--ink-muted");
    const grid = col("--rule");
    const palette = [col("--series-1"), col("--series-2"), col("--series-3"), col("--series-4"), col("--series-5")];
    ctx.clearRect(0, 0, W, H);
    ctx.font = `12px ${css.getPropertyValue("--font-ui") || "sans-serif"}`;

    const [x0, x1] = this.currentView();
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const s of spec.series) {
      for (let i = 0; i < s.x.length; i++) {
        const xv = s.x[i]!;
        if (xv < x0 || xv > x1) continue;
        const yv = s.y[i]!;
        if (yv < y0) y0 = yv;
        if (yv > y1) y1 = yv;
      }
    }
    if (!(y1 > y0)) {
      y0 = Number.isFinite(y0) ? y0 - 1 : 0;
      y1 = y0 + 2;
    }
    const pad = (y1 - y0) * 0.08;
    y1 += pad * 1.6;
    y0 = spec.yFloorZero && y0 >= 0 ? 0 : y0 - pad;

    const yTicks = niceTicks(y0, y1, Math.max(3, Math.floor(H / 55)));
    const yStep = yTicks.length > 1 ? yTicks[1]! - yTicks[0]! : 1;
    const yLabels = yTicks.map((v) => tickText(v, yStep));
    const l = Math.max(...yLabels.map((t) => ctx.measureText(t).width)) + 30;
    const plot = { l, t: 10, w: W - l - 12, h: H - 10 - 38 };
    this.plot = plot;
    const px = (v: number): number => plot.l + ((v - x0) / (x1 - x0)) * plot.w;
    const py = (v: number): number => plot.t + plot.h - ((v - y0) / (y1 - y0)) * plot.h;

    // Bands, grid, axes.
    ctx.fillStyle = col("--band");
    for (const [a, b] of spec.bands ?? []) ctx.fillRect(px(Math.max(a, x0)), plot.t, px(Math.min(b, x1)) - px(Math.max(a, x0)), plot.h);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = mutedInk;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    yTicks.forEach((v, i) => {
      ctx.beginPath();
      ctx.moveTo(plot.l, Math.round(py(v)) + 0.5);
      ctx.lineTo(plot.l + plot.w, Math.round(py(v)) + 0.5);
      ctx.stroke();
      ctx.fillText(yLabels[i]!, plot.l - 6, py(v));
    });
    const xTicks = niceTicks(x0, x1, Math.max(3, Math.floor(plot.w / 80)));
    const xStep = xTicks.length > 1 ? xTicks[1]! - xTicks[0]! : 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const v of xTicks) {
      ctx.beginPath();
      ctx.moveTo(Math.round(px(v)) + 0.5, plot.t + plot.h);
      ctx.lineTo(Math.round(px(v)) + 0.5, plot.t + plot.h + 4);
      ctx.stroke();
      ctx.fillText(tickText(v, xStep), px(v), plot.t + plot.h + 6);
    }
    ctx.fillStyle = ink;
    ctx.fillText(spec.xLabel, plot.l + plot.w / 2, plot.t + plot.h + 22);
    ctx.save();
    ctx.translate(12, plot.t + plot.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(spec.yLabel, 0, 0);
    ctx.restore();
    ctx.strokeStyle = mutedInk;
    ctx.strokeRect(plot.l + 0.5, plot.t + 0.5, plot.w, plot.h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.l, plot.t, plot.w, plot.h);
    ctx.clip();
    spec.series.forEach((s, si) => {
      const style = s.style ?? si;
      ctx.strokeStyle = s.muted ? mutedInk : palette[style % palette.length]!;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = s.muted ? 1 : 1.6;
      ctx.setLineDash(s.muted ? [3, 3] : DASHES[style % DASHES.length]!);
      if (s.points) {
        ctx.setLineDash([]);
        for (let i = 0; i < s.x.length; i++) {
          ctx.beginPath();
          ctx.arc(px(s.x[i]!), py(s.y[i]!), 4, 0, 2 * Math.PI);
          ctx.fill();
        }
        return;
      }
      // Min-max decimation: one vertical span per pixel column keeps every spike visible.
      ctx.beginPath();
      let started = false;
      let colPx = -1;
      let lo = 0;
      let hi = 0;
      let lastY = 0;
      const flush = (): void => {
        if (colPx < 0) return;
        if (!started) {
          ctx.moveTo(colPx, py(lo));
          started = true;
        }
        ctx.lineTo(colPx, py(lo));
        ctx.lineTo(colPx, py(hi));
        ctx.lineTo(colPx, py(lastY));
      };
      for (let i = 0; i < s.x.length; i++) {
        const xv = s.x[i]!;
        if (xv < x0 - (x1 - x0) * 0.01 || xv > x1 + (x1 - x0) * 0.01) continue;
        const c = Math.round(px(xv));
        const yv = s.y[i]!;
        if (c !== colPx) {
          flush();
          colPx = c;
          lo = yv;
          hi = yv;
        } else {
          if (yv < lo) lo = yv;
          if (yv > hi) hi = yv;
        }
        lastY = yv;
      }
      flush();
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.strokeStyle = mutedInk;
    ctx.lineWidth = 1;
    for (const d of spec.drops ?? []) {
      ctx.beginPath();
      ctx.moveTo(px(d.x), py(d.y0));
      ctx.lineTo(px(d.x), py(d.y1));
      ctx.stroke();
    }
    ctx.restore();

    // Peak labels sit above the apex, nudged so neighbours do not overprint.
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    let lastRight = -Infinity;
    let lastTop = Infinity;
    for (const m of [...(spec.markers ?? [])].sort((a, b) => a.x - b.x)) {
      if (m.x < x0 || m.x > x1) continue;
      const w = ctx.measureText(m.text).width;
      const cx = px(m.x);
      let top = Math.max(plot.t + 12, py(m.y) - 4);
      if (cx - w / 2 < lastRight + 3 && Math.abs(top - lastTop) < 13) top = Math.max(plot.t + 12, lastTop - 13);
      ctx.fillText(m.text, cx, top);
      lastRight = cx + w / 2;
      lastTop = top;
    }

    if (this.drag) {
      ctx.fillStyle = col("--band");
      ctx.fillRect(px(this.drag.x0), plot.t, px(this.drag.x1) - px(this.drag.x0), plot.h);
    }
    if (this.cursor !== null && this.cursor >= x0 && this.cursor <= x1) {
      ctx.strokeStyle = mutedInk;
      ctx.beginPath();
      ctx.moveTo(px(this.cursor), plot.t);
      ctx.lineTo(px(this.cursor), plot.t + plot.h);
      ctx.stroke();
      const s = spec.series[0];
      if (s && !s.points && s.x.length > 1) {
        const step = (s.x[s.x.length - 1]! - s.x[0]!) / (s.x.length - 1);
        const i = Math.min(s.x.length - 1, Math.max(0, Math.round((this.cursor - s.x[0]!) / step)));
        this.readout.textContent = `${spec.xLabel.split(",")[0]} ${this.cursor.toFixed(3)}   ${spec.yLabel.split(",")[0]} ${s.y[i]!.toPrecision(4)}`;
      }
    } else if (this.view) {
      this.readout.textContent = `Zoomed: ${this.view[0].toFixed(2)} to ${this.view[1].toFixed(2)}`;
    } else this.readout.textContent = "Drag across the plot to zoom.";
  }
}
