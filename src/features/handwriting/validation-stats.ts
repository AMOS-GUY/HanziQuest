/**
 * Statistics for the M13 human-validation study (M13_VALIDATION_PROTOCOL.md, D-082, D-083).
 *
 * Pure functions, no database and no grading: nothing here changes how handwriting is scored.
 * The writer is the independent unit, so every function that summarises samples works on
 * per-writer counts ("clusters").
 *
 * - Planning: exact sample sizes, power, design effect and the writers a design needs (§8).
 * - Analysis: the per-writer cap (§4), an intra-writer correlation estimate, a writer-level
 *   cluster bootstrap, and the protocol's decision bound for each measure (§3, §9).
 *
 * Synthetic inputs (tests, simulations) are never evidence about real learners.
 */
import { wilson } from "@/features/measurement/stats";
import { binomialCdf, exactLowerBound, exactUpperBound } from "@/lib/statistics/binomial";

// ─── Planning ───────────────────────────────────────────────────────────────

/** Design effect for m samples per writer with intra-writer correlation rho. */
export function designEffect(m: number, rho: number): number {
  if (m < 1) throw new Error("designEffect: m must be at least 1");
  if (rho < 0 || rho > 1) throw new Error("designEffect: rho must be between 0 and 1");
  return 1 + (m - 1) * rho;
}

/** Effective (independent-equivalent) sample size. */
export function effectiveSampleSize(n: number, m: number, rho: number): number {
  return n / designEffect(m, rho);
}

/**
 * Smallest effective n for which `allowed` observed events still give an exact one-sided upper
 * bound at or below `target`.
 */
export function requiredEffectiveN(target: number, allowed: number, alpha = 0.05): number {
  if (!(target > 0 && target < 1)) throw new Error("requiredEffectiveN: target must be in (0, 1)");
  let n = allowed + 1;
  while (binomialCdf(allowed, n, target) > alpha) n += 1;
  return n;
}

/** The largest number of events that still passes (upper bound ≤ target), or −1 if none does. */
export function passingEvents(n: number, target: number, alpha = 0.05): number {
  let c = -1;
  for (let x = 0; x <= n; x += 1) {
    if (exactUpperBound(x, n, alpha) <= target) c = x;
    else break;
  }
  return c;
}

/** Probability of passing (upper bound ≤ target) if the true rate is `trueRate`. */
export function powerToPass(n: number, target: number, trueRate: number, alpha = 0.05): number {
  const c = passingEvents(n, target, alpha);
  return c < 0 ? 0 : binomialCdf(c, n, trueRate);
}

/** Smallest effective n with at least `power` probability of passing, searched in `step`s. */
export function effectiveNForPower(
  target: number,
  trueRate: number,
  options: { alpha?: number; power?: number; step?: number; max?: number } = {},
): number | null {
  const { alpha = 0.05, power = 0.8, step = 25, max = 50_000 } = options;
  for (let n = step; n <= max; n += step)
    if (powerToPass(n, target, trueRate, alpha) >= power) return n;
  return null;
}

/** Writers needed to reach an effective n with m samples per writer and correlation rho. */
export function writersNeeded(effectiveN: number, m: number, rho: number): number {
  return Math.ceil((effectiveN * designEffect(m, rho)) / m);
}

/** One-sided alpha for each of `looks` pre-planned looks (Bonferroni, §9). */
export function lookAlpha(looks: number, alpha = 0.05): number {
  if (!Number.isInteger(looks) || looks < 1) throw new Error("lookAlpha: looks must be ≥ 1");
  return alpha / looks;
}

// ─── Analysis ───────────────────────────────────────────────────────────────

/**
 * The per-writer cap (§4): keep at most `cap` samples per writer and condition, the earliest
 * first. Returns the kept samples in their original order, and how many were set aside.
 */
export function capPerWriter<T>(
  samples: readonly T[],
  key: (s: T) => { writer: string; condition: string; at: number },
  cap = 2,
): { kept: T[]; excluded: number } {
  const order = samples
    .map((s, i) => ({ s, i, k: key(s) }))
    .sort((a, b) => a.k.at - b.k.at || a.i - b.i);
  const seen = new Map<string, number>();
  const keep = new Set<number>();
  for (const { i, k } of order) {
    const id = `${k.writer}\u0000${k.condition}`;
    const count = seen.get(id) ?? 0;
    if (count < cap) keep.add(i);
    seen.set(id, count + 1);
  }
  return { kept: samples.filter((_, i) => keep.has(i)), excluded: samples.length - keep.size };
}

/** Per-writer counts: `events` out of `n` samples. */
export interface WriterCount {
  events: number;
  n: number;
}

/**
 * Intra-writer correlation for a binary outcome (one-way ANOVA estimator), or null when it can't
 * be estimated: fewer than 2 writers, no within-writer replication, or no variation at all (for
 * example, zero events everywhere). Clamped to [0, 1].
 */
export function intraWriterCorrelation(writers: readonly WriterCount[]): number | null {
  const w = writers.filter((c) => c.n > 0);
  const k = w.length;
  const N = w.reduce((s, c) => s + c.n, 0);
  if (k < 2 || N <= k) return null;
  const pBar = w.reduce((s, c) => s + c.events, 0) / N;
  if (pBar === 0 || pBar === 1) return null;
  const ssb = w.reduce((s, c) => s + c.n * (c.events / c.n - pBar) ** 2, 0);
  const ssw = w.reduce((s, c) => s + c.events * (1 - c.events / c.n), 0);
  const msb = ssb / (k - 1);
  const msw = ssw / (N - k);
  const n0 = (N - w.reduce((s, c) => s + c.n * c.n, 0) / N) / (k - 1);
  const denominator = msb + (n0 - 1) * msw;
  if (denominator <= 0) return null;
  return Math.min(1, Math.max(0, (msb - msw) / denominator));
}

/**
 * Leave-one-writer-out stability (§4): the pooled rate without each writer in turn, and whether
 * removing any single writer moves the rate across `target`. An unstable result must not be the
 * basis of a decision.
 */
export function leaveOneWriterOut(
  writers: readonly WriterCount[],
  target: number,
): { rates: (number | null)[]; unstable: boolean } {
  const events = writers.reduce((s, c) => s + c.events, 0);
  const total = writers.reduce((s, c) => s + c.n, 0);
  const full = total ? events / total : null;
  const rates = writers.map((c) => (total - c.n > 0 ? (events - c.events) / (total - c.n) : null));
  const side = (r: number) => r <= target;
  const unstable = full !== null && rates.some((r) => r !== null && side(r) !== side(full));
  return { rates, unstable };
}

/** Deterministic PRNG (mulberry32) so a bootstrap result can be reproduced from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Writer-level cluster bootstrap of the pooled rate: writers are resampled with replacement.
 * Returns the percentile interval (two-sided, 1 − alpha), or null when every resample would be
 * identical (zero events or all events): use `decisionBound` for those.
 */
export function clusterBootstrapInterval(
  writers: readonly WriterCount[],
  options: { replicates?: number; seed?: number; alpha?: number } = {},
): [number, number] | null {
  const { replicates = 10_000, seed = 20261120, alpha = 0.05 } = options;
  const w = writers.filter((c) => c.n > 0);
  const events = w.reduce((s, c) => s + c.events, 0);
  const total = w.reduce((s, c) => s + c.n, 0);
  if (w.length < 2 || events === 0 || events === total) return null;
  const r = rng(seed);
  const rates: number[] = [];
  for (let b = 0; b < replicates; b += 1) {
    let e = 0;
    let n = 0;
    for (let i = 0; i < w.length; i += 1) {
      const c = w[Math.floor(r() * w.length)]!;
      e += c.events;
      n += c.n;
    }
    rates.push(e / n);
  }
  rates.sort((a, b) => a - b);
  const at = (q: number) => rates[Math.min(rates.length - 1, Math.floor(q * rates.length))]!;
  return [at(alpha / 2), at(1 - alpha / 2)];
}

export interface DecisionBound {
  events: number;
  samples: number;
  writers: number;
  rate: number | null;
  /** "Assumes independence (optimistic)": for reference only. */
  naiveWilson: [number, number] | null;
  /** The correlation used for the effective sample size (estimate, floored at `rhoFloor`). */
  rho: number;
  rhoEstimated: boolean;
  effectiveSamples: number;
  /** Exact one-sided bounds on the effective sample size, at the look's alpha. */
  upper: number | null;
  lower: number | null;
  /** Writer-level bootstrap interval, when events vary (null otherwise). */
  bootstrap: [number, number] | null;
}

/**
 * The protocol's decision bound for one measure (§3, §9). The effective sample size uses the
 * estimated intra-writer correlation, never below `rhoFloor` (0.10 by default, §8). Exact
 * one-sided bounds at `alpha` (use `lookAlpha` for planned looks) decide pass and fail.
 */
export function decisionBound(
  writers: readonly WriterCount[],
  options: { alpha?: number; rhoFloor?: number; rho?: number } = {},
): DecisionBound {
  const { alpha = 0.05, rhoFloor = 0.1 } = options;
  const w = writers.filter((c) => c.n > 0);
  const events = w.reduce((s, c) => s + c.events, 0);
  const samples = w.reduce((s, c) => s + c.n, 0);
  const estimate = options.rho ?? intraWriterCorrelation(w);
  const rho = Math.max(rhoFloor, estimate ?? 0);
  const meanPerWriter = w.length ? samples / w.length : 0;
  const effective = samples ? effectiveSampleSize(samples, Math.max(1, meanPerWriter), rho) : 0;
  // The observed events, scaled to the effective sample size (rounded up: conservative).
  const effN = Math.max(0, Math.floor(effective));
  const effEvents = samples ? Math.min(effN, Math.ceil((events / samples) * effN)) : 0;
  return {
    events,
    samples,
    writers: w.length,
    rate: samples ? events / samples : null,
    naiveWilson: samples ? wilson(events, samples) : null,
    rho,
    rhoEstimated: estimate !== null && options.rho === undefined,
    effectiveSamples: effective,
    upper: effN > 0 ? exactUpperBound(effEvents, effN, alpha) : null,
    lower: effN > 0 ? exactLowerBound(effEvents, effN, alpha) : null,
    bootstrap: clusterBootstrapInterval(w, { alpha: 2 * alpha }),
  };
}

/** The protocol's decision for one acceptance-type measure (upper bound against target). */
export function decide(
  bound: DecisionBound,
  target: number,
): "pass" | "fail" | "inconclusive" | "no-data" {
  if (bound.upper === null || bound.lower === null) return "no-data";
  if (bound.upper <= target) return "pass";
  if (bound.lower > target) return "fail";
  return "inconclusive";
}
