/**
 * Statistics for the M13 human-validation study (M13_VALIDATION_PROTOCOL.md, D-082, D-083).
 *
 * Pure functions, no database and no grading: nothing here changes how handwriting is scored,
 * and nothing here is wired into the lab or the report. The writer is the independent unit, so
 * every function that summarises samples works on per-writer counts ("clusters").
 *
 * - Planning: exact sample sizes, power, design effect, writers needed, look schedule (§8, §9).
 * - Analysis: the per-writer cap (§4), intra-writer correlation, writer-level cluster bootstrap
 *   (§3), leave-one-writer-out (§4), the decision bound and rule for each measure (§3, §9), and
 *   the per-pair finding rule for look-alike pairs (§6).
 *
 * Synthetic inputs (tests, simulations) are never evidence about real learners.
 *
 * **Status: not validated for confirmatory decisions.** The planning functions are exact
 * arithmetic. The decision intervals rest on assumptions that haven't been independently
 * reviewed (docs/M13_STATISTICAL_REVIEW_PROPOSAL.md):
 * - writers are independent, and samples are exchangeable within a writer;
 * - one intra-writer correlation ρ describes a measure, floored at 0.10 when it can't be
 *   estimated well (it rarely can with rare events);
 * - scaling events to an effective n and applying an exact binomial bound approximates a
 *   clustered binomial (a design-effect approximation, not an exact method);
 * - the percentile bootstrap under-covers with few writers or rare events.
 *
 * Until that review is done, results from these functions are **exploratory**: fine for
 * planning, synthetic dry runs and descriptive reporting with their caveats, but not for a pass
 * or fail claim about the engine.
 */
import { wilson } from "@/features/measurement/stats";
import { binomialCdf, exactLowerBound, exactUpperBound } from "@/lib/statistics/binomial";

// ─── Planning ───────────────────────────────────────────────────────────────

/** Design effect for m samples per writer with intra-writer correlation rho. */
export function designEffect(m: number, rho: number): number {
  if (!(m >= 1)) throw new Error("designEffect: m must be at least 1");
  if (!(rho >= 0 && rho <= 1)) throw new Error("designEffect: rho must be between 0 and 1");
  return 1 + (m - 1) * rho;
}

/** Effective (independent-equivalent) sample size. */
export function effectiveSampleSize(n: number, m: number, rho: number): number {
  return n / designEffect(m, rho);
}

function assertTarget(name: string, target: number) {
  if (!(target > 0 && target < 1)) throw new Error(`${name}: target must be in (0, 1)`);
}

/**
 * True when `events` out of `n` give an exact one-sided upper bound at or below `target`.
 * Equivalent to P(X ≤ events | n, target) ≤ alpha, which avoids the bisection tolerance.
 */
function upperBoundMeets(events: number, n: number, target: number, alpha: number): boolean {
  return binomialCdf(events, n, target) <= alpha;
}

/**
 * Smallest effective n for which `allowed` observed events still give an exact one-sided upper
 * bound at or below `target`.
 */
export function requiredEffectiveN(target: number, allowed: number, alpha = 0.05): number {
  assertTarget("requiredEffectiveN", target);
  if (!Number.isInteger(allowed) || allowed < 0)
    throw new Error("requiredEffectiveN: allowed must be a non-negative integer");
  let n = allowed + 1;
  while (!upperBoundMeets(allowed, n, target, alpha)) n += 1;
  return n;
}

/** The largest number of events that still passes (upper bound ≤ target), or −1 if none does. */
export function passingEvents(n: number, target: number, alpha = 0.05): number {
  assertTarget("passingEvents", target);
  // P(X ≤ x | target) grows with x, so the passing counts are 0..c.
  let c = -1;
  while (c + 1 < n && upperBoundMeets(c + 1, n, target, alpha)) c += 1;
  return c;
}

/** Probability of passing (upper bound ≤ target) if the true rate is `trueRate`. */
export function powerToPass(n: number, target: number, trueRate: number, alpha = 0.05): number {
  const c = passingEvents(n, target, alpha);
  return c < 0 ? 0 : binomialCdf(c, n, trueRate);
}

/**
 * Smallest effective n, searched in `step`s, with at least `power` probability of passing.
 * Power is not monotone in n (it saw-tooths as the passing count steps up), so a slightly larger
 * n can have slightly lower power. Use `powerToPass` to check a planned n directly.
 */
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

/** The planned looks for W evaluation writers: about 50 %, 75 % and 100 % of W (§9). */
export function lookSchedule(plannedWriters: number): number[] {
  if (!Number.isInteger(plannedWriters) || plannedWriters < 2)
    throw new Error("lookSchedule: plannedWriters must be an integer ≥ 2");
  return [
    ...new Set([Math.ceil(plannedWriters * 0.5), Math.ceil(plannedWriters * 0.75), plannedWriters]),
  ];
}

// ─── Analysis ───────────────────────────────────────────────────────────────

/** What identifies a capped cell (§4): one writer, one character, one condition. */
export interface CapKey {
  writer: string;
  character: string;
  /** Correct, a specific substitution, missing stroke, extra stroke, wrong order, wrong direction. */
  condition: string;
  /** When the sample was recorded; the earliest samples are kept. */
  at: number;
}

/**
 * The per-writer cap (§4): keep at most `cap` samples for each (writer, character, condition),
 * the earliest first. Returns the kept samples in their original order, and how many were set
 * aside (recorded, but excluded from the estimates).
 */
export function capPerWriter<T>(
  samples: readonly T[],
  key: (s: T) => CapKey,
  cap = 2,
): { kept: T[]; excluded: number } {
  if (!Number.isInteger(cap) || cap < 1) throw new Error("capPerWriter: cap must be ≥ 1");
  const order = samples
    .map((s, i) => ({ i, k: key(s) }))
    .sort((a, b) => a.k.at - b.k.at || a.i - b.i);
  const seen = new Map<string, number>();
  const keep = new Set<number>();
  for (const { i, k } of order) {
    const id = JSON.stringify([k.writer, k.character, k.condition]);
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

/** Validates counts and drops writers with no samples (they carry no information). */
function clean(writers: readonly WriterCount[]): WriterCount[] {
  for (const c of writers)
    if (
      !Number.isInteger(c.n) ||
      !Number.isInteger(c.events) ||
      c.n < 0 ||
      c.events < 0 ||
      c.events > c.n
    )
      throw new Error("writer counts must be integers with 0 ≤ events ≤ n");
  return writers.filter((c) => c.n > 0);
}

function totals(w: readonly WriterCount[]) {
  return {
    events: w.reduce((s, c) => s + c.events, 0),
    samples: w.reduce((s, c) => s + c.n, 0),
  };
}

/**
 * Intra-writer correlation for a binary outcome (one-way ANOVA estimator), or null when it can't
 * be estimated: fewer than 2 writers, no within-writer replication, or no variation at all (for
 * example, zero events everywhere). Clamped to [0, 1]. With rare events it is very imprecise.
 */
export function intraWriterCorrelation(writers: readonly WriterCount[]): number | null {
  const w = clean(writers);
  const k = w.length;
  const { events, samples: N } = totals(w);
  if (k < 2 || N <= k) return null;
  const pBar = events / N;
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
 * removing any single writer moves the point estimate across `target`. An unstable result must
 * not be the basis of a decision.
 */
export function leaveOneWriterOut(
  writers: readonly WriterCount[],
  target: number,
): { rates: (number | null)[]; unstable: boolean } {
  const w = clean(writers);
  const { events, samples } = totals(w);
  const full = samples ? events / samples : null;
  const rates = w.map((c) => (samples - c.n > 0 ? (events - c.events) / (samples - c.n) : null));
  const meets = (r: number) => r <= target;
  const unstable = full !== null && rates.some((r) => r !== null && meets(r) !== meets(full));
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

/** Writers below which a bootstrap is too coarse to report (resamples repeat too often). */
export const MIN_BOOTSTRAP_WRITERS = 10;

/**
 * Writer-level cluster bootstrap of the pooled rate (§3): writers are resampled with
 * replacement, and the percentile interval (two-sided, 1 − alpha) is returned. Null when every
 * resample would be identical (zero events or all events) or there are fewer than
 * `MIN_BOOTSTRAP_WRITERS` writers: the exact bound on the effective n is used then.
 */
export function clusterBootstrapInterval(
  writers: readonly WriterCount[],
  options: { replicates?: number; seed?: number; alpha?: number } = {},
): [number, number] | null {
  const { replicates = 10_000, seed = 20261120, alpha = 0.05 } = options;
  if (!Number.isInteger(replicates) || replicates < 100)
    throw new Error("clusterBootstrapInterval: replicates must be an integer ≥ 100");
  const w = clean(writers);
  const { events, samples } = totals(w);
  if (w.length < MIN_BOOTSTRAP_WRITERS || events === 0 || events === samples) return null;
  const r = rng(seed);
  const rates = new Float64Array(replicates);
  for (let b = 0; b < replicates; b += 1) {
    let e = 0;
    let n = 0;
    for (let i = 0; i < w.length; i += 1) {
      const c = w[Math.floor(r() * w.length)]!;
      e += c.events;
      n += c.n;
    }
    rates[b] = e / n;
  }
  rates.sort();
  // Type-1 (inverse empirical CDF) percentiles: the smallest value with at least q of the mass.
  const at = (q: number) =>
    rates[Math.min(replicates - 1, Math.max(0, Math.ceil(q * replicates) - 1))]!;
  return [at(alpha / 2), at(1 - alpha / 2)];
}

/**
 * The evidential status of every result from this module. It stays "exploratory" until an
 * independent statistical review is done and the decision rule is pre-registered
 * (docs/M13_STATISTICAL_REVIEW_PROPOSAL.md). Code that displays or stores a decision must show
 * it, so a "pass" is never read as a validated claim.
 */
export const EVIDENCE_STATUS = "exploratory" as const;

export interface DecisionBound {
  /** Always EVIDENCE_STATUS: no result from this module is confirmatory evidence. */
  evidence: typeof EVIDENCE_STATUS;
  events: number;
  samples: number;
  writers: number;
  rate: number | null;
  /** "Assumes independence (optimistic)": for reference only, never for a decision. */
  naiveWilson: [number, number] | null;
  /** The correlation used for the design effect (estimate or given, never below the floor). */
  rho: number;
  rhoEstimated: boolean;
  /** Size-weighted cluster size Σnᵢ² / N, used in the design effect (equals m when equal). */
  clusterSize: number;
  effectiveSamples: number;
  /** Exact one-sided bounds on the effective sample size, at the look's alpha. */
  exactUpper: number | null;
  exactLower: number | null;
  /** Writer-level bootstrap interval (1 − 2·alpha two-sided, so each end is one-sided alpha). */
  bootstrap: [number, number] | null;
  /** The rule that chose the deciding bounds (see `DecisionRule`). */
  rule: DecisionRule;
  /** Which interval decided: one of the two, or the worse of both ("conservative"). */
  method: "bootstrap" | "exact-effective-n" | "conservative" | "none";
  /** The deciding one-sided bounds. */
  upper: number | null;
  lower: number | null;
}

/**
 * How the deciding bounds are chosen when both intervals exist.
 *
 * - `"conservative"` (default): the worse bound of the two in each direction (the larger upper,
 *   the smaller lower). This is a **heuristic, not a validated confidence procedure**: the
 *   maximum of two bounds has no stated coverage of its own. It's the default because the
 *   alternative is known to be optimistic. In a synthetic simulation sketch (beta-binomial
 *   writers, equal sizes, one look; scripts/m13-coverage-sketch.ts), the §3 rule's nominal 95 %
 *   upper bound covered the true rate only 80–88 % of the time when events varied, and at a
 *   true rate equal to a 1 % target it "passed" 15–24 % of studies. The exact bound on the
 *   effective n, and so this rule, covered 95–100 %. Other designs weren't tested.
 * - `"bootstrap-first"`: §3 as written. The bootstrap whenever it exists, the exact bound only
 *   where it can't be used. Kept so the protocol's literal rule can be reproduced. Changing §3
 *   is an owner decision after an independent statistical review.
 */
export type DecisionRule = "conservative" | "bootstrap-first";

/**
 * The protocol's decision bound for one measure (§3, §9).
 *
 * - Every decision interval is writer-level: the cluster bootstrap, the exact one-sided bound on
 *   the effective n, or the worse of the two (`rule`, default `"conservative"`). Where the
 *   bootstrap can't be used (zero or all events, or too few writers), the exact bound decides.
 * - The effective n uses the design effect with the size-weighted cluster size Σnᵢ²/N (Kish;
 *   equal to m when writers contribute equally, larger and so more conservative when they
 *   don't), and ρ never below `rhoFloor` (0.10, §3). Pass `rho` to use an estimate from other
 *   cells, as §3 says for zero-event cells.
 * - Events are scaled to the effective n and rounded **up** for the upper bound and **down** for
 *   the lower bound, so each bound is conservative in its own direction.
 * - `alpha` is per look: use `lookAlpha(looks)` for planned looks.
 */
export function decisionBound(
  writers: readonly WriterCount[],
  options: {
    alpha?: number;
    rhoFloor?: number;
    rho?: number;
    replicates?: number;
    seed?: number;
    rule?: DecisionRule;
  } = {},
): DecisionBound {
  const { alpha = 0.05, rhoFloor = 0.1, rule = "conservative" } = options;
  if (!(alpha > 0 && alpha < 0.5)) throw new Error("decisionBound: alpha must be in (0, 0.5)");
  const w = clean(writers);
  const { events, samples } = totals(w);
  const estimate = options.rho ?? intraWriterCorrelation(w);
  const rho = Math.max(rhoFloor, estimate ?? 0);
  const clusterSize = samples ? w.reduce((s, c) => s + c.n * c.n, 0) / samples : 0;
  const effective = samples ? effectiveSampleSize(samples, Math.max(1, clusterSize), rho) : 0;
  const effN = Math.floor(effective);
  const rate = samples ? events / samples : null;
  let exactUpper: number | null = null;
  let exactLower: number | null = null;
  if (effN > 0 && rate !== null) {
    exactUpper = exactUpperBound(Math.min(effN, Math.ceil(rate * effN)), effN, alpha);
    exactLower = exactLowerBound(Math.min(effN, Math.floor(rate * effN)), effN, alpha);
  }
  const bootstrap = clusterBootstrapInterval(w, {
    alpha: 2 * alpha,
    replicates: options.replicates,
    seed: options.seed,
  });
  let method: DecisionBound["method"] = "none";
  let upper: number | null = null;
  let lower: number | null = null;
  if (bootstrap && exactUpper !== null && exactLower !== null && rule === "conservative") {
    method = "conservative";
    upper = Math.max(bootstrap[1], exactUpper);
    lower = Math.min(bootstrap[0], exactLower);
  } else if (bootstrap) {
    method = "bootstrap";
    [lower, upper] = bootstrap;
  } else if (exactUpper !== null) {
    method = "exact-effective-n";
    upper = exactUpper;
    lower = exactLower;
  }
  return {
    events,
    samples,
    writers: w.length,
    rate,
    naiveWilson: samples ? wilson(events, samples) : null,
    rho,
    rhoEstimated: estimate !== null && options.rho === undefined,
    clusterSize,
    effectiveSamples: effective,
    exactUpper,
    exactLower,
    bootstrap,
    rule,
    evidence: EVIDENCE_STATUS,
    method,
    upper,
    lower,
  };
}

/**
 * A decision is exploratory (see EVIDENCE_STATUS): "pass" means the chosen bound met the target
 * under this module's unvalidated assumptions, not that the engine meets it.
 */
export type Decision = "pass" | "fail" | "expand" | "inconclusive" | "no-data";

/**
 * The §9 decision for one measure at one look.
 *
 * - `direction: "at-most"` (default) is for rates that must be low (false acceptance, FRR):
 *   pass when the upper bound ≤ target, fail when the lower bound > target.
 * - `direction: "at-least"` is for rates that must be high (specific error named ≥ 80 %):
 *   pass when the lower bound ≥ target, fail when the upper bound < target.
 * - Otherwise: **expand** to the next look, or **inconclusive** at the final look (report the
 *   bound actually shown, and claim nothing about the target).
 */
export function decide(
  bound: DecisionBound,
  target: number,
  options: { direction?: "at-most" | "at-least"; finalLook?: boolean } = {},
): Decision {
  const { direction = "at-most", finalLook = true } = options;
  assertTarget("decide", target);
  if (bound.upper === null || bound.lower === null) return "no-data";
  if (direction === "at-most") {
    if (bound.upper <= target) return "pass";
    if (bound.lower > target) return "fail";
  } else {
    if (bound.lower >= target) return "pass";
    if (bound.upper < target) return "fail";
  }
  return finalLook ? "inconclusive" : "expand";
}

/** One wrong-character sample for a look-alike pair (§6). */
export interface PairSample {
  /** The pair, for example "他/她", as the confusable suite names it. */
  pair: string;
  writer: string;
  accepted: boolean;
}

export interface PairSummary {
  pair: string;
  accepted: number;
  written: number;
  writers: number;
  /** Writers with at least one accepted sample. */
  acceptingWriters: number;
  /** §6: accepted in ≥ 2 samples from ≥ 2 different writers, whatever the pooled rate. */
  finding: boolean;
}

/**
 * Per-pair descriptive counts for look-alike pairs (§6). Per-pair n is small, so these are never
 * compared with the 1 % target on their own: the pooled rate is judged with `decisionBound`.
 */
export function pairSummaries(samples: readonly PairSample[]): PairSummary[] {
  const byPair = new Map<string, PairSample[]>();
  for (const s of samples) byPair.set(s.pair, [...(byPair.get(s.pair) ?? []), s]);
  return [...byPair.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([pair, list]) => {
      const accepted = list.filter((s) => s.accepted);
      const acceptingWriters = new Set(accepted.map((s) => s.writer)).size;
      return {
        pair,
        accepted: accepted.length,
        written: list.length,
        writers: new Set(list.map((s) => s.writer)).size,
        acceptingWriters,
        finding: accepted.length >= 2 && acceptingWriters >= 2,
      };
    });
}

/** Per-writer counts from labelled samples, for `decisionBound` and friends. */
export function countByWriter<T>(
  samples: readonly T[],
  writer: (s: T) => string,
  isEvent: (s: T) => boolean,
): WriterCount[] {
  const counts = new Map<string, WriterCount>();
  for (const s of samples) {
    const c = counts.get(writer(s)) ?? { events: 0, n: 0 };
    c.n += 1;
    if (isEvent(s)) c.events += 1;
    counts.set(writer(s), c);
  }
  return [...counts.keys()].sort().map((k) => counts.get(k)!);
}
