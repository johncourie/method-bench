import { describe, expect, it } from "vitest";
import { cases, catalog, checks, columns, instruments, literature, references, solutes } from "../src/data/index.ts";
import { computeBands } from "../src/engine/simulate.ts";

const BASES = ["reported", "digitized", "fitted", "assumed"];

describe("data set", () => {
  it("every provenance record names a known reference and a valid basis", () => {
    const provs = [
      ...columns.map((c) => c.prov),
      ...solutes.flatMap((s) => [s.uvProv, ...(s.ionization ? [s.ionization.prov] : []), ...Object.values(s.retention).flatMap((m) => Object.values(m).map((p) => p!.prov))]),
    ];
    expect(provs.length).toBeGreaterThan(100);
    for (const p of provs) {
      expect(BASES).toContain(p.basis);
      expect(references[p.ref], `reference ${p.ref}`).toBeDefined();
    }
    for (const r of Object.values(references)) {
      expect(r.citation.length).toBeGreaterThan(20);
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.license.length).toBeGreaterThan(3);
    }
  });

  it("numbers are finite and physically sensible", () => {
    for (const s of solutes) {
      expect(s.mw).toBeGreaterThan(50);
      expect(Math.abs(s.monoMass - s.mw)).toBeLessThan(1);
      expect(s.uv.length).toBeGreaterThan(0);
      for (const b of s.uv) expect(b.eps > 0 && b.width > 0 && b.nm > 190 && b.nm <= 420).toBe(true);
      for (const m of Object.values(s.retention)) {
        for (const p of Object.values(m)) {
          expect(Number.isFinite(p!.lnkw) && Number.isFinite(p!.S1)).toBe(true);
          expect(p!.S1).toBeGreaterThanOrEqual(0);
          expect(p!.S1).toBeLessThan(40);
          expect(p!.phiRange[0]).toBeLessThan(p!.phiRange[1]);
        }
      }
    }
    for (const c of columns) {
      expect(c.porosityTotal > 0.3 && c.porosityTotal < 0.8).toBe(true);
      expect(c.lengthMm > 0 && c.idMm > 0 && c.particleUm > 0).toBe(true);
    }
    expect(instruments.length).toBeGreaterThanOrEqual(2);
  });

  it("every case is complete: all its compounds have retention on all its columns", () => {
    expect(cases.length).toBe(2);
    for (const c of cases) {
      const ids = [...c.analytes, ...c.extraStandards, ...Object.keys(c.composition), ...Object.keys(c.matrix), ...c.variants.flatMap((v) => Object.keys(v.add ?? {})), ...c.reactions.flatMap((r) => [r.from, ...(r.to ? [r.to] : []), ...(r.coProduct ? [r.coProduct] : [])])];
      for (const id of new Set(ids)) {
        const s = catalog.solutes.get(id);
        expect(s, `${c.id}: solute ${id}`).toBeDefined();
        for (const col of c.columns) for (const mod of c.modifiers) expect(s!.retention[col]?.[mod], `${id} on ${col}`).toBeDefined();
      }
      for (const col of c.columns) expect(catalog.columns.get(col)).toBeDefined();
      expect(c.columns).toContain(c.defaultMethod.columnId);
      for (const r of c.reactions) expect(references[r.ref]).toBeDefined();
      for (const t of c.totals) for (const term of t.terms) expect(c.analytes).toContain(term.id);
      for (const r of c.ratios) expect(c.analytes).toEqual(expect.arrayContaining([r.num, r.den]));
      expect(new Set(c.variants.map((v) => v.id)).size).toBe(c.variants.length);
      // Hidden matrix compounds must not be offered as standards.
      for (const id of [...c.analytes, ...c.extraStandards]) expect(catalog.solutes.get(id)!.hidden ?? false).toBe(false);
    }
    for (const k of checks) expect(references[k.ref]).toBeDefined();
  });
});

describe("literature reproduction", () => {
  const run = (id: string) => {
    const l = literature.find((x) => x.id === id)!;
    const column = catalog.columns.get(l.method.columnId)!;
    const bands = computeBands({
      method: l.method,
      instrument: { ...instruments[0]!, dwellMl: l.dwellMl, extraColVarUl2: 0, pMaxBar: 5000 },
      column: { ...column, pMaxBar: 5000 },
      sample: { id, label: id, diluentPhi: l.method.program[0]!.phi, components: l.reported.map((r) => ({ soluteId: r.soluteId, ugPerMl: 10 })) },
      solutes: catalog.solutes,
      seed: id,
    });
    return l.reported.map((r) => ({ id: r.soluteId, published: r.tR, model: bands.find((b) => b.soluteId === r.soluteId)!.tR }));
  };

  it("methods used for calibration are reproduced within 1.5% on their own column", () => {
    for (const l of literature.filter((x) => x.usedInFit)) {
      for (const r of run(l.id)) expect(Math.abs(r.model / r.published - 1), `${l.id} ${r.id}`).toBeLessThan(0.015);
    }
  });

  it("a published cannabinoid gradient on a different C18 is predicted within 6% with the right elution order", () => {
    const rows = run("abc2024");
    for (const r of rows) expect(Math.abs(r.model / r.published - 1), r.id).toBeLessThan(0.06);
    const order = (k: "published" | "model") => [...rows].sort((a, b) => a[k] - b[k]).map((r) => r.id);
    expect(order("model")).toEqual(order("published"));
  });

  it("held-out predictions exist for every multi-analyte C18 catechin method and stay within 35%", () => {
    const held = literature.filter((l) => l.heldOut);
    expect(held.length).toBe(6);
    for (const l of held) {
      for (const h of l.heldOut!) {
        const pub = l.reported.find((r) => r.soluteId === h.soluteId)!.tR;
        expect(Math.abs(h.tR / pub - 1), `${l.id} ${h.soluteId}`).toBeLessThan(0.35);
      }
    }
  });
});
