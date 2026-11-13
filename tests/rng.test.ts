import { describe, expect, it } from "vitest";
import { makeRng } from "../src/engine/rng.ts";

describe("seeded random numbers", () => {
  it("streams from seeds that differ only in a run number are unrelated and standard normal", () => {
    const first = Array.from({ length: 4000 }, (_, i) => makeRng(`case|CODE|run|${i}`).gauss());
    const mean = first.reduce((s, v) => s + v, 0) / first.length;
    const sd = Math.sqrt(first.reduce((s, v) => s + (v - mean) ** 2, 0) / first.length);
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(sd).toBeGreaterThan(0.95);
    expect(sd).toBeLessThan(1.05);
    // Lag-one correlation between consecutive run numbers.
    let c = 0;
    for (let i = 1; i < first.length; i++) c += first[i]! * first[i - 1]!;
    expect(Math.abs(c / first.length)).toBeLessThan(0.06);
    // Tails exist: about 4.6% beyond two standard deviations.
    const tail = first.filter((v) => Math.abs(v) > 2).length / first.length;
    expect(tail).toBeGreaterThan(0.03);
    expect(tail).toBeLessThan(0.065);
  });
});
