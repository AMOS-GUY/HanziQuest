/**
 * Mastery and spaced-repetition model. Pure functions: the whole state for one character is
 * replayed from its attempt history (ordered by when the learner wrote it), which keeps the
 * result identical however and whenever offline attempts reach the server.
 *
 * Rules (see docs/DECISIONS.md D-020):
 *  - Only independent attempts (no hints, not traced) advance the review schedule or mastery.
 *    Guided practice is recorded separately and never makes a character "mastered".
 *  - A success (EXCELLENT / GOOD) advances the schedule only when the review is due, or while the
 *    character is still being learned (repetitions = 0). Repeating it early does not count, so
 *    cramming within one session cannot inflate intervals.
 *  - A failure (NEEDS_IMPROVEMENT / TRY_AGAIN) is a lapse: it halves the repetition count,
 *    resets the interval and brings the review back within minutes.
 *  - Skipped exercises are ignored.
 */
import type { AttemptResult, MasteryLevel, PracticeMode } from "@/generated/prisma/enums";

export interface CharacterEvent {
  occurredAt: Date;
  mode: PracticeMode;
  result: AttemptResult;
}

export interface ReviewState {
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt: Date | null;
}

export interface MasteryState {
  level: MasteryLevel;
  strength: number;
  guidedAttempts: number;
  guidedSuccesses: number;
  independentAttempts: number;
  independentSuccesses: number;
  consecutiveIndependent: number;
  firstSeenAt: Date;
  lastPracticedAt: Date;
}

export const SRS = {
  initialEase: 2.5,
  minEase: 1.3,
  maxEase: 3,
  maxIntervalDays: 365,
  /** A due review may be done this fraction of its interval early and still count. */
  earlyFraction: 0.15,
  relearnMinutes: 10,
  /** First exposure through guided practice only: come back to it the same day. */
  guidedFirstHours: 4,
  familiarRepetitions: 2,
  masteredRepetitions: 4,
} as const;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const QUALITY: Record<Exclude<AttemptResult, "SKIPPED">, number> = {
  EXCELLENT: 5,
  GOOD: 4,
  NEEDS_IMPROVEMENT: 2,
  TRY_AGAIN: 1,
};

export function isSuccess(result: AttemptResult) {
  return result === "EXCELLENT" || result === "GOOD";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function nextInterval(repetitions: number, previous: number, ease: number) {
  if (repetitions <= 1) return 1;
  if (repetitions === 2) return 3;
  return Math.min(SRS.maxIntervalDays, round2(Math.max(1, previous) * ease));
}

function levelFor(review: ReviewState | null, lastIndependentSucceeded: boolean): MasteryLevel {
  if (!review) return "LEARNING";
  if (lastIndependentSucceeded && review.repetitions >= SRS.masteredRepetitions) return "MASTERED";
  if (lastIndependentSucceeded && review.repetitions >= SRS.familiarRepetitions) return "FAMILIAR";
  return "LEARNING";
}

export interface ReplayResult {
  mastery: MasteryState;
  review: ReviewState;
}

/** Replays a character's history. Returns null when there is no countable practice. */
export function replayCharacter(events: readonly CharacterEvent[]): ReplayResult | null {
  const ordered = events
    .filter((e) => e.result !== "SKIPPED")
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  if (ordered.length === 0) return null;

  const m: MasteryState = {
    level: "LEARNING",
    strength: 0,
    guidedAttempts: 0,
    guidedSuccesses: 0,
    independentAttempts: 0,
    independentSuccesses: 0,
    consecutiveIndependent: 0,
    firstSeenAt: ordered[0]!.occurredAt,
    lastPracticedAt: ordered[0]!.occurredAt,
  };
  let review: ReviewState | null = null;
  let lastIndependentSucceeded = false;

  for (const e of ordered) {
    const t = e.occurredAt.getTime();
    const success = isSuccess(e.result);
    const q = QUALITY[e.result as keyof typeof QUALITY];
    m.lastPracticedAt = e.occurredAt;

    if (e.mode === "GUIDED") {
      m.guidedAttempts += 1;
      if (success) m.guidedSuccesses += 1;
      // Guided practice nudges strength a little but is capped well below independent recall.
      const target = success ? 0.5 : 0.1;
      if (m.strength < target) m.strength += 0.1 * (target - m.strength);
      review ??= {
        dueAt: new Date(t + SRS.guidedFirstHours * 60 * MINUTE),
        intervalDays: 0,
        easeFactor: SRS.initialEase,
        repetitions: 0,
        lapses: 0,
        lastReviewedAt: null,
      };
      continue;
    }

    m.independentAttempts += 1;
    m.strength += 0.3 * ((success ? 1 : q === 2 ? 0.35 : 0) - m.strength);
    lastIndependentSucceeded = success;
    const r: ReviewState = review ?? {
      dueAt: new Date(t),
      intervalDays: 0,
      easeFactor: SRS.initialEase,
      repetitions: 0,
      lapses: 0,
      lastReviewedAt: null,
    };

    if (success) {
      m.independentSuccesses += 1;
      m.consecutiveIndependent += 1;
      const earlyBy = r.intervalDays * SRS.earlyFraction * DAY;
      const due = t >= r.dueAt.getTime() - earlyBy;
      if (r.repetitions === 0 || due) {
        r.repetitions += 1;
        r.easeFactor = Math.min(
          SRS.maxEase,
          Math.max(SRS.minEase, round2(r.easeFactor + 0.1 - (5 - q) * 0.08)),
        );
        r.intervalDays = nextInterval(r.repetitions, r.intervalDays, r.easeFactor);
        r.dueAt = new Date(t + r.intervalDays * DAY);
        r.lastReviewedAt = e.occurredAt;
      }
    } else {
      m.consecutiveIndependent = 0;
      if (r.repetitions > 0) r.lapses += 1;
      r.repetitions = Math.floor(r.repetitions / 2);
      r.easeFactor = Math.max(SRS.minEase, round2(r.easeFactor - (q === 2 ? 0.15 : 0.2)));
      r.intervalDays = 0;
      r.dueAt = new Date(t + SRS.relearnMinutes * MINUTE);
      r.lastReviewedAt = e.occurredAt;
    }
    review = r;
  }

  m.strength = round2(Math.min(1, Math.max(0, m.strength)));
  m.level = levelFor(review, lastIndependentSucceeded);
  return { mastery: m, review: review! };
}
