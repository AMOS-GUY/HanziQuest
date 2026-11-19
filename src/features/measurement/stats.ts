/**
 * Statistics for learning measurement (M15). Pure functions.
 *
 * A Proportion carries its counts, its rate and a 95 % Wilson score interval. `contributors` is
 * the number of distinct learners behind the counts: event-level metrics (one learner can
 * contribute many reviews) are suppressed on contributors, not events, and their intervals
 * assume independent events, so they understate uncertainty when a few learners dominate.
 */

export interface Proportion {
  successes: number;
  n: number;
  /** Distinct learners contributing to n. */
  contributors: number;
  /** successes / n, or null when n = 0. */
  rate: number | null;
  /** 95 % Wilson score interval, or null when n = 0. */
  interval: [number, number] | null;
}

export interface Distribution {
  /** Items that reached the milestone (the distribution is over these). */
  n: number;
  /** Items observed that haven't reached it yet (censored: excluded from the quantiles). */
  notYet: number;
  contributors: number;
  /** Days, or null when n = 0. */
  median: number | null;
  p25: number | null;
  p75: number | null;
}

const Z95 = 1.959963984540054;

/** Wilson score interval for k successes out of n (n > 0). */
export function wilson(k: number, n: number, z = Z95): [number, number] {
  if (n <= 0) throw new Error("wilson: n must be positive");
  if (k < 0 || k > n) throw new Error("wilson: k must be between 0 and n");
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function proportion(successes: number, n: number, contributors: number): Proportion {
  return {
    successes,
    n,
    contributors,
    rate: n ? successes / n : null,
    interval: n ? wilson(successes, n) : null,
  };
}

/** Quantile by linear interpolation between order statistics (type 7, as R and NumPy). */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function distribution(values: number[], notYet: number, contributors: number): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    notYet,
    contributors,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
  };
}
