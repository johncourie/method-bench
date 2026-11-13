// Peak profiles. docs/MODEL.md section 7.

/** Scaled complementary error function erfcx(x) = exp(x^2) erfc(x), for x >= 0 (Numerical Recipes Chebyshev form). */
function erfcxPos(x: number): number {
  const t = 1 / (1 + 0.5 * x);
  const poly =
    -1.26551223 +
    t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  return t * Math.exp(poly);
}

const SQRT2 = Math.SQRT2;
const SQRT2PI = Math.sqrt(2 * Math.PI);

/** Unit-area Gaussian. */
export function gaussian(t: number, mu: number, sigma: number): number {
  const z = (t - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * SQRT2PI);
}

/**
 * Unit-area exponentially modified Gaussian: a Gaussian (mu, sigma) convolved
 * with an exponential decay of time constant tau. Evaluated through erfcx so it
 * stays finite for small tau.
 */
export function emg(t: number, mu: number, sigma: number, tau: number): number {
  if (tau < 0.02 * sigma) return gaussian(t, mu, sigma);
  const z = (sigma / tau - (t - mu) / sigma) / SQRT2;
  const g = Math.exp(-0.5 * ((t - mu) / sigma) ** 2);
  if (z >= 0) return (g / (2 * tau)) * erfcxPos(z);
  // erfc(z) = 2 - erfc(-z) for z < 0.
  const e = Math.exp((sigma * sigma) / (2 * tau * tau) - (t - mu) / tau);
  return (1 / (2 * tau)) * (2 * e - g * erfcxPos(-z));
}
