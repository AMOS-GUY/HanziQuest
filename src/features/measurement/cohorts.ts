/**
 * Fixed signup-week cohorts (M15). A cohort is every eligible learner who signed up in one ISO
 * week (Monday 00:00 UTC to the next Monday). Only whole weeks exist: no arbitrary date ranges,
 * so overlapping groups can't be subtracted from each other to single someone out.
 */

export type CohortWeek = string; // "2026-W46"

const WEEK = /^(\d{4})-W(\d{2})$/;
const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of ISO week 1 of `year`. */
function isoWeekOneMonday(year: number) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(jan4.getTime() - dow * DAY_MS);
}

/** The ISO week an instant falls in (UTC). */
export function cohortWeekOf(at: Date): CohortWeek {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(d.getTime() + (3 - dow) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week =
    Math.floor((thursday.getTime() - isoWeekOneMonday(year).getTime()) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Strict parse: only real ISO weeks are accepted. */
export function parseCohortWeek(value: string): { start: Date; end: Date } | null {
  const m = WEEK.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const start = new Date(isoWeekOneMonday(year).getTime() + (week - 1) * 7 * DAY_MS);
  // Week 53 exists only in some years: the round trip must agree.
  if (cohortWeekOf(start) !== value) return null;
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

/** The `count` most recent whole weeks before `now`'s week, newest first. */
export function recentCohortWeeks(now: Date, count: number): CohortWeek[] {
  const current = parseCohortWeek(cohortWeekOf(now))!;
  return Array.from({ length: count }, (_, i) =>
    cohortWeekOf(new Date(current.start.getTime() - (i + 1) * 7 * DAY_MS)),
  );
}
