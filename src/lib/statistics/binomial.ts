/**
 * Exact binomial tail probabilities and one-sided Clopper–Pearson bounds. Pure functions, no
 * dependencies. Used by M13 validation planning and analysis (M13_VALIDATION_PROTOCOL.md §8),
 * where decisions rest on exact bounds. The Wilson interval lives in features/measurement/stats.
 */

function assertCounts(name: string, x: number, n: number) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name}: n must be a non-negative integer`);
  if (!Number.isInteger(x)) throw new Error(`${name}: x must be an integer`);
}

function assertProbability(name: string, p: number) {
  if (!(p >= 0 && p <= 1)) throw new Error(`${name}: probability must be in [0, 1]`);
}

/**
 * P(X ≤ x) for X ~ Binomial(n, p). Terms are accumulated from a log-space recurrence, so large
 * n and small p don't underflow the first term.
 */
export function binomialCdf(x: number, n: number, p: number): number {
  assertCounts("binomialCdf", x, n);
  assertProbability("binomialCdf", p);
  if (x < 0) return 0;
  if (x >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return 0;
  const q = 1 - p;
  const logRatio = Math.log(p) - Math.log(q);
  let logTerm = n * Math.log1p(-p);
  let sum = Math.exp(logTerm);
  for (let k = 1; k <= x; k += 1) {
    logTerm += Math.log((n - k + 1) / k) + logRatio;
    sum += Math.exp(logTerm);
  }
  return Math.min(1, sum);
}

/**
 * Exact one-sided Clopper–Pearson upper bound at level 1 − alpha: the largest p with
 * P(X ≤ x | n, p) ≥ alpha. With x = 0 this is 1 − alpha^(1/n) (about 3/n for alpha = 0.05).
 * Found by bisection to well below 1e-12.
 */
export function exactUpperBound(x: number, n: number, alpha = 0.05): number {
  assertCounts("exactUpperBound", x, n);
  if (n === 0) throw new Error("exactUpperBound: n must be positive");
  if (x < 0 || x > n) throw new Error("exactUpperBound: x must be between 0 and n");
  if (!(alpha > 0 && alpha < 1)) throw new Error("exactUpperBound: alpha must be in (0, 1)");
  if (x === n) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(x, n, mid) > alpha) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Exact one-sided Clopper–Pearson lower bound at level 1 − alpha: the smallest p with
 * P(X ≥ x | n, p) ≥ alpha.
 */
export function exactLowerBound(x: number, n: number, alpha = 0.05): number {
  assertCounts("exactLowerBound", x, n);
  if (n === 0) throw new Error("exactLowerBound: n must be positive");
  if (x < 0 || x > n) throw new Error("exactLowerBound: x must be between 0 and n");
  if (!(alpha > 0 && alpha < 1)) throw new Error("exactLowerBound: alpha must be in (0, 1)");
  if (x === 0) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    // P(X ≥ x) = 1 − P(X ≤ x − 1)
    if (1 - binomialCdf(x - 1, n, mid) < alpha) lo = mid;
    else hi = mid;
  }
  return lo;
}
