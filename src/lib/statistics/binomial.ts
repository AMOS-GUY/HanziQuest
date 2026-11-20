/**
 * Exact binomial tail probabilities and one-sided Clopper–Pearson bounds. Pure functions, no
 * dependencies. Used by M13 validation planning and analysis (M13_VALIDATION_PROTOCOL.md §8),
 * where decisions rest on exact bounds. The Wilson interval lives in features/measurement/stats.
 */

/** P(X ≤ x) for X ~ Binomial(n, p), computed by a stable recurrence. */
export function binomialCdf(x: number, n: number, p: number): number {
  if (x < 0) return 0;
  if (x >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const q = 1 - p;
  // Work in logs for the first term so large n doesn't underflow.
  let logTerm = n * Math.log(q);
  let sum = Math.exp(logTerm);
  for (let k = 1; k <= x; k += 1) {
    logTerm += Math.log((n - k + 1) / k) + Math.log(p / q);
    sum += Math.exp(logTerm);
  }
  return Math.min(1, sum);
}

/**
 * Exact one-sided Clopper–Pearson upper bound: the largest p with P(X ≤ x | n, p) ≥ alpha.
 * With x = 0 this is 1 − alpha^(1/n) (about 3/n for alpha = 0.05).
 */
export function exactUpperBound(x: number, n: number, alpha = 0.05): number {
  if (n <= 0) throw new Error("exactUpperBound: n must be positive");
  if (x >= n) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(x, n, mid) > alpha) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Exact one-sided Clopper–Pearson lower bound: the smallest p with P(X ≥ x | n, p) ≥ alpha. */
export function exactLowerBound(x: number, n: number, alpha = 0.05): number {
  if (n <= 0) throw new Error("exactLowerBound: n must be positive");
  if (x <= 0) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    // P(X ≥ x) = 1 − P(X ≤ x − 1)
    if (1 - binomialCdf(x - 1, n, mid) < alpha) lo = mid;
    else hi = mid;
  }
  return lo;
}
