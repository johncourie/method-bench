// Shared pieces for the WebGL views. three.js is loaded on demand, so the forms,
// tables and charts work before (and without) it.

import type * as Three from "three";

export type ThreeModule = typeof Three;

let loading: Promise<ThreeModule> | null = null;
export function loadThree(): Promise<ThreeModule> {
  loading ??= import("three");
  return loading;
}

/** A colour token from the page theme. */
export function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Text drawn to a small canvas, for use as a texture. */
export function textCanvas(lines: string[], opts: { w: number; h: number; bg: string; fg: string; font?: string; align?: CanvasTextAlign }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = opts.w;
  c.height = opts.h;
  drawText(c, lines, opts);
  return c;
}

export function drawText(c: HTMLCanvasElement, lines: string[], opts: { bg: string; fg: string; font?: string; align?: CanvasTextAlign }): void {
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = opts.bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = opts.fg;
  const size = Math.floor(Math.min(c.height / (lines.length + 0.6), c.width / 9));
  g.font = opts.font ?? `600 ${size}px ui-monospace, Menlo, Consolas, monospace`;
  g.textAlign = opts.align ?? "left";
  g.textBaseline = "middle";
  const x = opts.align === "center" ? c.width / 2 : c.width * 0.06;
  lines.forEach((t, i) => g.fillText(t, x, ((i + 0.5) * c.height) / lines.length, c.width * 0.9));
}

/** Colour-blind-safe categorical colours (after Okabe and Ito), dark enough to read on a light page. */
export const CATEGORICAL = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#8f6b00", "#56b4e9", "#7a3fa0", "#5b5b5b"];

/** A perceptually ordered ramp from dark blue-violet through green to amber, for 0..1. */
export function ramp(t: number): string {
  const stops: Array<[number, number, number]> = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [224, 170, 30]];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [stops[i]!, stops[i + 1]!];
  const ch = (k: 0 | 1 | 2): number => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}
