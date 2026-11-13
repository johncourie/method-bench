// Small Levenberg-Marquardt least-squares solver with a numerical Jacobian.

export function levenbergMarquardt(residuals: (p: number[]) => number[], start: number[], iterations = 200): { p: number[]; sse: number } {
  let p = [...start];
  let r = residuals(p);
  let sse = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-2;
  const n = p.length;
  for (let it = 0; it < iterations; it++) {
    const J: number[][] = [];
    for (let j = 0; j < n; j++) {
      const q = [...p];
      const h = 1e-5 * Math.max(1, Math.abs(q[j]!));
      q[j]! += h;
      const rq = residuals(q);
      J.push(rq.map((v, i) => (v - r[i]!) / h));
    }
    const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const g = new Array<number>(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let i = 0; i < r.length; i++) g[a]! += J[a]![i]! * r[i]!;
      for (let b = a; b < n; b++) {
        let s = 0;
        for (let i = 0; i < r.length; i++) s += J[a]![i]! * J[b]![i]!;
        A[a]![b] = s;
        A[b]![a] = s;
      }
    }
    let improved = false;
    for (let tries = 0; tries < 12; tries++) {
      const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const step = solve(M, g.map((v) => -v));
      if (!step) {
        lambda *= 10;
        continue;
      }
      const q = p.map((v, i) => v + step[i]!);
      const rq = residuals(q);
      const s2 = rq.reduce((s, v) => s + v * v, 0);
      if (Number.isFinite(s2) && s2 < sse) {
        const gain = sse - s2;
        p = q;
        r = rq;
        sse = s2;
        lambda = Math.max(lambda / 4, 1e-10);
        improved = gain > 1e-12 * (1 + sse);
        break;
      }
      lambda *= 6;
    }
    if (!improved) break;
  }
  return { p, sse };
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (Math.abs(M[piv]![c]!) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}
