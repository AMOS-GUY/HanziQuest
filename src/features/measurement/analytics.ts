/**
 * Aggregate learning analytics: the only shape measurement results may leave the server in
 * (M15-b). k = 5 by default is a disclosure safeguard, not a claim that groups of five are
 * anonymous.
 *
 * Disclosure controls:
 * 1. Small groups: a value is shown only when at least k distinct learners contribute. A
 *    suppressed value carries no counts at all, only a reason.
 * 2. Dominance: an event-level value (reviews, recalls) is also suppressed when one learner
 *    contributes more than half of it, since it would mostly describe that learner.
 * 3. Whole cohorts: a cohort with fewer than k learners shows nothing but "fewer than k".
 * 4. Complementary suppression: in the interval buckets, if exactly one cell is suppressed, the
 *    shown cell with the fewest reviews is suppressed too, so no total or neighbouring value can
 *    recover it by subtraction.
 * 5. No differencing across groups: only fixed past signup weeks exist (no date ranges, no
 *    current week, whose membership still changes), and no cross-week totals are offered.
 *
 * Never returned: learner identifiers, per-learner values, the internal "largest contribution"
 * counts, or anything below k. Excluded from every count: staff and test accounts
 * (`population.ts`).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/permissions/permissions";
import type { RoleKey } from "@/generated/prisma/enums";
import { recentCohortWeeks, type CohortWeek } from "./cohorts";
import { measureCohort, type CohortMeasurement } from "./engine";
import type { Distribution, Proportion } from "./stats";

export const DEFAULT_MIN_GROUP = 5;
/** A value is suppressed when one learner contributes more than this share of it. */
export const DOMINANCE_SHARE = 0.5;

export type SuppressionReason = "small-group" | "dominated" | "complementary" | "no-data";

export type PublicRate =
  | {
      shown: true;
      /** Rounded to 0.1 percentage points. */
      rate: number;
      interval: [number, number];
      n: number;
      learners: number;
    }
  | { shown: false; reason: SuppressionReason };

export type PublicDistribution =
  | {
      shown: true;
      medianDays: number;
      p25Days: number;
      p75Days: number;
      n: number;
      notYet: number;
      learners: number;
    }
  | { shown: false; reason: SuppressionReason };

export interface PublicCohort {
  week: CohortWeek;
  /** Learners in the cohort, or a suppression reason. */
  learners: { shown: true; count: number } | { shown: false; reason: "small-group" };
  activation: PublicRate;
  returns: { d1: PublicRate; d7: PublicRate; d30: PublicRate };
  dueReviewCompletion: PublicRate;
  recallByInterval: { bucket: string; label: string; recall: PublicRate }[];
  lapseRate: PublicRate;
  daysToFamiliar: PublicDistribution;
  daysToMastered: PublicDistribution;
  placementAccuracy: PublicRate;
  funnel: { stage: string; label: string; reached: PublicRate }[];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Primary suppression of one rate. */
export function publicRate(p: Proportion, k: number, eventLevel: boolean): PublicRate {
  if (p.n === 0) return { shown: false, reason: "no-data" };
  if (p.contributors < k) return { shown: false, reason: "small-group" };
  if (eventLevel && p.largest > p.n * DOMINANCE_SHARE) return { shown: false, reason: "dominated" };
  return {
    shown: true,
    rate: round3(p.rate!),
    interval: [round3(p.interval![0]), round3(p.interval![1])],
    n: p.n,
    learners: p.contributors,
  };
}

export function publicDistribution(d: Distribution, k: number): PublicDistribution {
  if (d.n === 0) return { shown: false, reason: "no-data" };
  if (d.contributors < k) return { shown: false, reason: "small-group" };
  if (d.largest > d.n * DOMINANCE_SHARE) return { shown: false, reason: "dominated" };
  return {
    shown: true,
    medianDays: round1(d.median!),
    p25Days: round1(d.p25!),
    p75Days: round1(d.p75!),
    n: d.n,
    notYet: d.notYet,
    learners: d.contributors,
  };
}

/**
 * Complementary suppression for a family of cells that could be combined (the interval
 * buckets): exactly one primary suppression would be recoverable from any total, so the shown
 * cell with the smallest n is suppressed as well.
 */
export function complementary<T extends { recall: PublicRate }>(
  cells: T[],
  raw: Proportion[],
): T[] {
  const primary = cells.filter((c) => !c.recall.shown && c.recall.reason !== "no-data").length;
  if (primary !== 1) return cells;
  let smallest = -1;
  cells.forEach((c, i) => {
    if (c.recall.shown && (smallest < 0 || raw[i]!.n < raw[smallest]!.n)) smallest = i;
  });
  if (smallest < 0) return cells;
  return cells.map((c, i) =>
    i === smallest ? { ...c, recall: { shown: false, reason: "complementary" } } : c,
  );
}

const SUPPRESSED_RATE: PublicRate = { shown: false, reason: "small-group" };
const SUPPRESSED_DISTRIBUTION: PublicDistribution = { shown: false, reason: "small-group" };

/** The public form of one cohort's measurement. */
export function publicCohort(m: CohortMeasurement, k = DEFAULT_MIN_GROUP): PublicCohort {
  if (!Number.isInteger(k) || k < 2) throw new Error("The minimum group size must be at least 2.");
  const x = m.metrics;
  if (x.learners < k)
    return {
      week: m.week,
      learners: { shown: false, reason: "small-group" },
      activation: SUPPRESSED_RATE,
      returns: { d1: SUPPRESSED_RATE, d7: SUPPRESSED_RATE, d30: SUPPRESSED_RATE },
      dueReviewCompletion: SUPPRESSED_RATE,
      recallByInterval: x.recallByInterval.map((b) => ({
        bucket: b.bucket,
        label: b.label,
        recall: SUPPRESSED_RATE,
      })),
      lapseRate: SUPPRESSED_RATE,
      daysToFamiliar: SUPPRESSED_DISTRIBUTION,
      daysToMastered: SUPPRESSED_DISTRIBUTION,
      placementAccuracy: SUPPRESSED_RATE,
      funnel: x.funnel.map((f) => ({ stage: f.stage, label: f.label, reached: SUPPRESSED_RATE })),
    };
  const buckets = x.recallByInterval.map((b) => ({
    bucket: b.bucket,
    label: b.label,
    recall: publicRate(b.recall, k, true),
  }));
  return {
    week: m.week,
    learners: { shown: true, count: x.learners },
    activation: publicRate(x.activation, k, false),
    returns: {
      d1: publicRate(x.returns.d1, k, false),
      d7: publicRate(x.returns.d7, k, false),
      d30: publicRate(x.returns.d30, k, false),
    },
    dueReviewCompletion: publicRate(x.dueReviewCompletion, k, true),
    recallByInterval: complementary(
      buckets,
      x.recallByInterval.map((b) => b.recall),
    ),
    lapseRate: publicRate(x.lapseRate, k, true),
    daysToFamiliar: publicDistribution(x.daysToFamiliar, k),
    daysToMastered: publicDistribution(x.daysToMastered, k),
    placementAccuracy: publicRate(x.placementAccuracy, k, true),
    funnel: x.funnel.map((f) => ({
      stage: f.stage,
      label: f.label,
      reached: publicRate(f.reached, k, false),
    })),
  };
}

export class AnalyticsPermissionError extends Error {}

/**
 * Learning analytics for staff with `analytics:read`: the most recent whole signup weeks, each on
 * its own (no totals across weeks). Checked here as well as on the page.
 */
export async function learningAnalytics(
  prisma: PrismaClient,
  actor: { roles: readonly RoleKey[] },
  options: { weeks?: number; k?: number; now?: Date } = {},
): Promise<PublicCohort[]> {
  if (!hasPermission(actor.roles, "analytics:read"))
    throw new AnalyticsPermissionError("analytics:read is required");
  const now = options.now ?? new Date();
  const weeks = recentCohortWeeks(now, Math.min(Math.max(options.weeks ?? 8, 1), 26));
  const out: PublicCohort[] = [];
  for (const week of weeks)
    out.push(publicCohort(await measureCohort(prisma, week, { now }), options.k));
  return out;
}

/**
 * The page is off until the owner approves the privacy notice wording and the legal-version
 * decision (D-079): LEARNING_ANALYTICS=on enables it. Off by default everywhere.
 */
export function learningAnalyticsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.LEARNING_ANALYTICS?.trim().toLowerCase() === "on";
}
