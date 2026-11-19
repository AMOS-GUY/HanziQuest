/**
 * Learning metrics (M15-a). Pure functions over stored history; nothing here reads or writes the
 * database. Each learner's history becomes counts, counts from many learners are added up, and
 * only the totals leave this module: no per-learner value is ever returned.
 *
 * Definitions (docs/M15_MEASUREMENT.md has the interpretation):
 * - activation: completed a first lesson within 24 h of signing up. Eligible once 24 h passed.
 * - return Dn (n = 1, 7, 30): practised on the learner's local calendar day signup + n.
 *   Eligible once that day is over in the learner's time zone.
 * - due-review completion: of the reviews the schedule set at least a day ahead, the share
 *   written by 24 h after they fell due (from the early tolerance on). Eligible once due + 24 h.
 * - recall on due reviews, by interval bucket: success of independent recalls made when due,
 *   grouped by the interval that was in force.
 * - lapse rate: failed independent recalls of characters already learned (repetitions > 0),
 *   among all independent recalls of learned characters.
 * - time to FAMILIAR and to MASTERED: days from a character's first counted practice to the
 *   first time it reached that level; characters not there yet are counted as "not yet".
 * - placement accuracy: of characters in lessons the learner tested out of, the share whose first
 *   independent recall after the placement succeeded.
 *
 * Every rate is computed with the scheduling rules in force today (`SRS`). If M16 changes them,
 * historical due dates and intervals are reinterpreted under the new rules.
 */
import {
  replayCharacter,
  SRS,
  type CharacterEvent,
  type ReplayStep,
} from "@/features/progress/mastery";
import { addDays, localDay } from "@/features/progress/calendar";
import type { MasteryLevel } from "@/generated/prisma/enums";
import { distribution, proportion, type Distribution, type Proportion } from "./stats";

const DAY_MS = 86_400_000;

export interface LearnerHistory {
  createdAt: Date;
  timezone: string;
  /** Local calendar days ("YYYY-MM-DD") with at least one completed exercise. */
  activeDays: ReadonlySet<string>;
  /** First COMPLETED lesson (TESTED_OUT doesn't count). */
  firstLessonCompletedAt: Date | null;
  /** Counted attempt results per character. */
  characters: ReadonlyMap<string, readonly CharacterEvent[]>;
  /** The learner's completed placement, if any, and the characters it tested them out of. */
  placement: { completedAt: Date; testedOut: ReadonlySet<string> } | null;
}

export const RETURN_DAYS = [1, 7, 30] as const;

export const INTERVAL_BUCKETS = [
  { key: "relearn", label: "Relearning (under 1 day)", min: 0, max: 1 },
  { key: "1", label: "1 day", min: 1, max: 2 },
  { key: "2-3", label: "2–3 days", min: 2, max: 4 },
  { key: "4-7", label: "4–7 days", min: 4, max: 8 },
  { key: "8-14", label: "8–14 days", min: 8, max: 15 },
  { key: "15-30", label: "15–30 days", min: 15, max: 31 },
  { key: "31+", label: "31 days or more", min: 31, max: Infinity },
] as const;
export type IntervalBucket = (typeof INTERVAL_BUCKETS)[number]["key"];

export function intervalBucket(days: number): IntervalBucket {
  return INTERVAL_BUCKETS.find((b) => days >= b.min && days < b.max)!.key;
}

const RANK: Record<MasteryLevel, number> = { NEW: 0, LEARNING: 1, FAMILIAR: 2, MASTERED: 3 };

/** Counts one learner contributes. Internal: never returned to callers of the engine. */
interface Tally {
  k: number;
  n: number;
}
const tally = (): Tally => ({ k: 0, n: 0 });

interface LearnerCounts {
  activation: Tally;
  returns: Record<(typeof RETURN_DAYS)[number], Tally>;
  dueCompletion: Tally;
  recall: Record<IntervalBucket, Tally>;
  lapses: Tally;
  toFamiliar: { days: number[]; notYet: number };
  toMastered: { days: number[]; notYet: number };
  placement: Tally;
}

/** Counts for one learner, as of `now`. */
export function learnerCounts(h: LearnerHistory, now: Date): LearnerCounts {
  const c: LearnerCounts = {
    activation: tally(),
    returns: { 1: tally(), 7: tally(), 30: tally() },
    dueCompletion: tally(),
    recall: Object.fromEntries(
      INTERVAL_BUCKETS.map((b) => [b.key, tally()]),
    ) as LearnerCounts["recall"],
    lapses: tally(),
    toFamiliar: { days: [], notYet: 0 },
    toMastered: { days: [], notYet: 0 },
    placement: tally(),
  };
  const nowMs = now.getTime();
  const signup = h.createdAt.getTime();

  if (nowMs >= signup + DAY_MS) {
    c.activation.n = 1;
    if (h.firstLessonCompletedAt && h.firstLessonCompletedAt.getTime() <= signup + DAY_MS)
      c.activation.k = 1;
  }

  const signupDay = localDay(h.createdAt, h.timezone);
  const today = localDay(now, h.timezone);
  for (const n of RETURN_DAYS) {
    const day = addDays(signupDay, n);
    if (day >= today) continue; // the day isn't over yet
    c.returns[n].n = 1;
    if (h.activeDays.has(day)) c.returns[n].k = 1;
  }

  for (const [characterId, events] of h.characters) {
    const steps: ReplayStep[] = [];
    if (!replayCharacter(events, (s) => steps.push(s))) continue;
    const independent = steps.filter((s) => s.mode === "INDEPENDENT");
    const firstSeen = steps[0]!.occurredAt.getTime();

    for (const s of independent) {
      if (s.kind === "due") {
        const b = c.recall[intervalBucket(s.intervalBefore)];
        b.n += 1;
        if (s.success) b.k += 1;
      }
      if (s.repetitionsBefore > 0) {
        c.lapses.n += 1;
        if (s.lapse) c.lapses.k += 1;
      }
    }

    // Due-review completion: each review the schedule set at least a day ahead, once.
    let lastScheduled: number | null = null;
    independent.forEach((s, i) => {
      const due = s.dueAfter.getTime();
      if (s.intervalAfter < 1 || due === lastScheduled) return;
      lastScheduled = due;
      if (due + DAY_MS > nowMs) return; // not over yet
      const from = due - s.intervalAfter * SRS.earlyFraction * DAY_MS;
      const done = independent
        .slice(i + 1)
        .some((x) => x.occurredAt.getTime() >= from && x.occurredAt.getTime() <= due + DAY_MS);
      c.dueCompletion.n += 1;
      if (done) c.dueCompletion.k += 1;
    });

    for (const [level, out] of [
      ["FAMILIAR", c.toFamiliar],
      ["MASTERED", c.toMastered],
    ] as const) {
      const reached = steps.find((s) => RANK[s.levelAfter] >= RANK[level]);
      if (reached) out.days.push((reached.occurredAt.getTime() - firstSeen) / DAY_MS);
      else out.notYet += 1;
    }

    if (h.placement?.testedOut.has(characterId)) {
      const after = h.placement.completedAt.getTime();
      const first = independent.find((s) => s.occurredAt.getTime() > after);
      if (first) {
        c.placement.n += 1;
        if (first.success) c.placement.k += 1;
      }
    }
  }
  return c;
}

/** Totals over many learners. Only aggregates leave it. */
export class MeasurementTotals {
  private learners = 0;
  private readonly sums = {
    activation: { ...tally(), who: 0 },
    returns: Object.fromEntries(RETURN_DAYS.map((n) => [n, { ...tally(), who: 0 }])) as Record<
      (typeof RETURN_DAYS)[number],
      Tally & { who: number }
    >,
    dueCompletion: { ...tally(), who: 0 },
    recall: Object.fromEntries(
      INTERVAL_BUCKETS.map((b) => [b.key, { ...tally(), who: 0 }]),
    ) as Record<IntervalBucket, Tally & { who: number }>,
    lapses: { ...tally(), who: 0 },
    placement: { ...tally(), who: 0 },
  };
  private readonly familiar = { days: [] as number[], notYet: 0, who: 0 };
  private readonly mastered = { days: [] as number[], notYet: 0, who: 0 };

  add(c: LearnerCounts) {
    this.learners += 1;
    const into = (to: Tally & { who: number }, from: Tally) => {
      to.k += from.k;
      to.n += from.n;
      if (from.n > 0) to.who += 1;
    };
    into(this.sums.activation, c.activation);
    for (const n of RETURN_DAYS) into(this.sums.returns[n], c.returns[n]);
    into(this.sums.dueCompletion, c.dueCompletion);
    for (const b of INTERVAL_BUCKETS) into(this.sums.recall[b.key], c.recall[b.key]);
    into(this.sums.lapses, c.lapses);
    into(this.sums.placement, c.placement);
    for (const [to, from] of [
      [this.familiar, c.toFamiliar],
      [this.mastered, c.toMastered],
    ] as const) {
      to.days.push(...from.days);
      to.notYet += from.notYet;
      if (from.days.length || from.notYet) to.who += 1;
    }
  }

  result(): CohortMetrics {
    const p = (t: Tally & { who: number }) => proportion(t.k, t.n, t.who);
    return {
      learners: this.learners,
      activation: p(this.sums.activation),
      returns: {
        d1: p(this.sums.returns[1]),
        d7: p(this.sums.returns[7]),
        d30: p(this.sums.returns[30]),
      },
      dueReviewCompletion: p(this.sums.dueCompletion),
      recallByInterval: INTERVAL_BUCKETS.map((b) => ({
        bucket: b.key,
        label: b.label,
        recall: p(this.sums.recall[b.key]),
      })),
      lapseRate: p(this.sums.lapses),
      daysToFamiliar: distribution(this.familiar.days, this.familiar.notYet, this.familiar.who),
      daysToMastered: distribution(this.mastered.days, this.mastered.notYet, this.mastered.who),
      placementAccuracy: p(this.sums.placement),
    };
  }
}

/** Aggregates for one cohort. Every field is a total over the cohort's learners. */
export interface CohortMetrics {
  learners: number;
  activation: Proportion;
  returns: { d1: Proportion; d7: Proportion; d30: Proportion };
  dueReviewCompletion: Proportion;
  recallByInterval: { bucket: IntervalBucket; label: string; recall: Proportion }[];
  lapseRate: Proportion;
  daysToFamiliar: Distribution;
  daysToMastered: Distribution;
  placementAccuracy: Proportion;
}
