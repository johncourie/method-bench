// Draws the Method Bench mark: three chromatographic peaks that read as an M, on a baseline.
// The outline is the sum of three Gaussians, so the shape is the thing it stands for.
// Run: node tools/make-logo.ts   (writes branding/*.svg and public/favicon.svg)

import { mkdirSync, writeFileSync } from "node:fs";

const TEAL = "#0b5a7a";
const TEAL_ON_DARK = "#7cc8e6";
const INK = "#14181f";

/** Peak centres, heights and widths, in units of the mark's width and height. */
const PEAKS = [
  { x: 0.27, h: 0.7, s: 0.05 },
  { x: 0.5, h: 1.0, s: 0.05 },
  { x: 0.735, h: 0.52, s: 0.05 },
];
const profile = (u: number, widen: number): number => PEAKS.reduce((y, p) => y + p.h * Math.exp(-0.5 * ((u - p.x) / (p.s * widen)) ** 2), 0);

/**
 * Path for the mark inside a box at (x, y) of size w by h. The baseline is part of the shape.
 * `bold` thickens the baseline and widens the peaks a little, for use at icon sizes.
 */
function markPath(x: number, y: number, w: number, h: number, bold = false): string {
  const base = h * (bold ? 0.075 : 0.045); // baseline thickness
  const widen = bold ? 1.14 : 1;
  const top = h - base;
  const n = 160;
  const f = (v: number): string => v.toFixed(2).replace(/\.?0+$/, "");
  let d = `M${f(x)} ${f(y + h)}V${f(y + top)}`;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    d += `L${f(x + u * w)} ${f(y + top - Math.min(1, profile(u, widen)) * top)}`;
  }
  return `${d}V${f(y + h)}Z`;
}

const svg = (viewBox: string, body: string, title: string, extra = ""): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}"${extra}>\n<title>${title}</title>\n${body}\n</svg>\n`;

const out = (path: string, text: string): void => writeFileSync(new URL(path, import.meta.url), text);
mkdirSync(new URL("../branding/", import.meta.url), { recursive: true });
mkdirSync(new URL("../public/", import.meta.url), { recursive: true });

// The mark alone, in the project teal and in one colour that follows the text around it.
out("../branding/mark.svg", svg("0 0 400 260", `<path fill="${TEAL}" d="${markPath(10, 14, 380, 232)}"/>`, "Method Bench"));
out("../branding/mark-on-dark.svg", svg("0 0 400 260", `<path fill="${TEAL_ON_DARK}" d="${markPath(10, 14, 380, 232)}"/>`, "Method Bench"));
out("../branding/mark-mono.svg", svg("0 0 400 260", `<path fill="currentColor" d="${markPath(10, 14, 380, 232)}"/>`, "Method Bench"));

// Square icon. It switches to the lighter teal when the browser's own interface is dark.
const icon = `<style>.mb{fill:${TEAL}}@media (prefers-color-scheme: dark){.mb{fill:${TEAL_ON_DARK}}}</style>\n<path class="mb" d="${markPath(3, 9, 58, 47, true)}"/>`;
out("../public/favicon.svg", svg("0 0 64 64", icon, "Method Bench"));
out("../branding/icon.svg", svg("0 0 64 64", icon, "Method Bench"));

// Mark with the name beside it. The name is live text in a system face, so it stays sharp and selectable.
const font = `font-family="system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" font-weight="600" font-size="74" letter-spacing="-1"`;
const lockup = (mark: string, ink: string): string => `<path fill="${mark}" d="${markPath(8, 22, 190, 116)}"/>\n<text x="226" y="126" ${font} fill="${ink}">Method Bench</text>`;
out("../branding/lockup.svg", svg("0 0 720 160", lockup(TEAL, INK), "Method Bench"));
out("../branding/lockup-on-dark.svg", svg("0 0 720 160", lockup(TEAL_ON_DARK, "#eceff4"), "Method Bench"));
console.log("wrote branding/mark.svg, mark-on-dark.svg, mark-mono.svg, icon.svg, lockup.svg, lockup-on-dark.svg and public/favicon.svg");
