// Minimal DOM helpers. No framework.

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, "").toLowerCase(), v);
    else if (k === "class") el.className = String(v);
    else if (k === "value" && "value" in el) (el as HTMLInputElement).value = String(v);
    else if (k === "checked" || k === "disabled" || k === "selected" || k === "open") {
      if (v) el.setAttribute(k, "");
    } else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Fixed number of significant figures without exponent noise for ordinary magnitudes. */
export function sig(x: number, n = 3): string {
  if (!Number.isFinite(x)) return "n/a";
  if (x === 0) return "0";
  const mag = Math.floor(Math.log10(Math.abs(x)));
  if (mag >= n || mag < -4) return x.toExponential(n - 1);
  return x.toFixed(Math.max(0, n - 1 - mag));
}

export function fixed(x: number, n: number): string {
  return Number.isFinite(x) ? x.toFixed(n) : "n/a";
}

const idCounts = new Map<string, number>();
/** Restart id numbering so a redraw gives the same control the same id (focus is restored by id). */
export function resetIds(): void {
  idCounts.clear();
}

/** Lower-case letters, digits and hyphens from any text. */
export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "x";
}

/** An id built from what a control is called. Repeats within one draw get a numeric suffix. */
export function uid(name: string): string {
  const base = slug(name);
  const n = idCounts.get(base) ?? 0;
  idCounts.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

/** A labelled form control. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || uid(`f-${label}`);
  control.id = id;
  const wrap = h("div", { class: "field" }, h("label", { for: id }, label), control);
  if (hint) {
    const hid = `${id}-hint`;
    control.setAttribute("aria-describedby", hid);
    wrap.appendChild(h("small", { id: hid }, hint));
  }
  return wrap;
}

/**
 * A number field. An empty or unreadable entry is put back to the previous value
 * instead of being read as zero, and the value is held inside min and max.
 */
export function numberInput(value: number, opts: { min?: number; max?: number; step?: number; onChange: (v: number) => void }): HTMLInputElement {
  const shown = Number.isFinite(value) ? String(Number(value.toPrecision(10))) : "";
  const el = h("input", { type: "number", value: shown, min: opts.min, max: opts.max, step: opts.step ?? "any", inputmode: "decimal" });
  el.addEventListener("change", () => {
    const v = el.value.trim() === "" ? NaN : Number(el.value);
    if (!Number.isFinite(v)) {
      el.value = shown;
      return;
    }
    const held = Math.min(opts.max ?? Infinity, Math.max(opts.min ?? -Infinity, v));
    if (held !== v) el.value = String(held);
    opts.onChange(held);
  });
  return el;
}

export function select<T extends string>(value: T, options: ReadonlyArray<{ value: T; label: string }>, onChange: (v: T) => void): HTMLSelectElement {
  const el = h("select", {}, options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));
  el.value = value;
  el.addEventListener("change", () => onChange(el.value as T));
  return el;
}

export function table(headers: string[], rows: Array<Array<Child>>, caption?: string): HTMLTableElement {
  return h(
    "table",
    {},
    caption ? h("caption", {}, caption) : null,
    h("thead", {}, h("tr", {}, headers.map((x) => h("th", { scope: "col" }, x)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", {}, c)))))),
  );
}
