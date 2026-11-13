// The sample notebooks in public/examples must load in this version and show what their descriptions say.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "../src/data/index.ts";
import { calibrate, quantify, recoveries, suitability } from "../src/lab/analysis.ts";
import { contentAsReceived, truthFor } from "../src/lab/samples.ts";
import { Lab, loadSession } from "../src/lab/session.ts";

const open = (name: string): Lab => new Lab(catalog, loadSession(readFileSync(new URL(`../public/examples/${name}`, import.meta.url), "utf8"), catalog));
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

describe("sample notebooks", () => {
  it("hemp full exercise: calibration, six preparations, nine spikes, replicates, and a result near the truth", () => {
    const lab = open("hemp-full-exercise.json");
    const a = lab.session.analysis;
    const method = lab.session.runs.find((r) => r.id === a.refRun)!.method;
    const cal = calibrate(lab, method, "cbd", a.weighting, a.response);
    expect(cal.fit!.r2).toBeGreaterThan(0.999);
    const res = quantify(lab, method, cal, a.response);
    expect(res.length).toBe(6);
    expect(recoveries(lab, method, cal, a.response).length).toBe(9);
    expect(suitability(lab, method, "cbn")!.n).toBeGreaterThanOrEqual(6);
    const truth = truthFor(lab.case, lab.session.seed);
    const expected = contentAsReceived(lab.case, lab.session.seed, catalog.solutes).cbd! * truth.recovery;
    expect(Math.abs(mean(res.map((r) => r.mgPerG)) / expected - 1)).toBeLessThan(0.04);
  });

  it("green tea scouting: the two gradients carry the same nine names, ready to fit", () => {
    const lab = open("greentea-scouting-and-fit.json");
    const named = lab.session.runs.slice(1, 3).map((r) => [...lab.execute(r).names.values()].sort());
    expect(named[0]!.length).toBe(9);
    expect(named[1]).toEqual(named[0]);
  });

  it("green tea interferent: EGCG reads high under the starting gradient and lower once the interferent is separated", () => {
    const lab = open("greentea-coeluting-interferent.json");
    expect(truthFor(lab.case, lab.session.seed).variant.id).toBe("interferent");
    const methods = [...new Map(lab.session.runs.map((r) => [JSON.stringify(r.method.program), r.method])).values()];
    expect(methods.length).toBe(2);
    const egcg = methods.map((m) => mean(quantify(lab, m, calibrate(lab, m, "egcg", "1/x", "area"), "area").map((r) => r.mgPerG)));
    expect(egcg[0]! / egcg[1]!).toBeGreaterThan(1.05);
    const expected = contentAsReceived(lab.case, lab.session.seed, catalog.solutes).egcg! * truthFor(lab.case, lab.session.seed).recovery;
    expect(Math.abs(egcg[1]! / expected - 1)).toBeLessThan(0.04);
  });
});
