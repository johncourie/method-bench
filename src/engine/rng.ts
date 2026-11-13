// Seeded random numbers so that every student and every re-run sees the same noise
// for the same seed and injection.

/** 32-bit string hash (xmur3). */
export function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface Rng {
  /** Uniform on [0, 1). */
  next(): number;
  /** Standard normal. */
  gauss(): number;
  /** Uniform on [lo, hi). */
  range(lo: number, hi: number): number;
}

/** mulberry32 generator. */
export function makeRng(seed: number | string): Rng {
  // Seeds that differ only in a trailing run number must give unrelated streams:
  // hash the text twice with different salts and combine.
  let a = typeof seed === "string" ? (hashString(seed) ^ Math.imul(hashString(`${seed}#`), 0x9e3779b1)) >>> 0 : seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 8; i++) next(); // discard the start of the stream
  let spare: number | null = null;
  const gauss = (): number => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = next();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * next();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
  return { next, gauss, range: (lo, hi) => lo + (hi - lo) * next() };
}
