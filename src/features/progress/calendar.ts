/** Calendar helpers in the learner's own timezone. Days are "YYYY-MM-DD" strings. */

function safeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/** The learner's local calendar day for an instant. */
export function localDay(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** A "YYYY-MM-DD" day as the Date Prisma stores in a `@db.Date` column. */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function dateToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + delta);
  return dateToDay(d);
}

export interface StreakSummary {
  /** Run of consecutive active days ending today or yesterday (0 if broken). */
  current: number;
  longest: number;
  /** Run ending on the most recent active day, regardless of today. */
  latestRun: number;
  lastActiveDay: string | null;
}

/**
 * Computes streaks from the set of active days. Recomputed from scratch so that offline
 * activity synced out of order is counted on the day it actually happened.
 */
export function computeStreak(activeDays: Iterable<string>, today: string): StreakSummary {
  const days = [...new Set(activeDays)].filter((d) => d <= today).sort();
  if (days.length === 0) return { current: 0, longest: 0, latestRun: 0, lastActiveDay: null };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = addDays(days[i - 1]!, 1) === days[i] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const last = days[days.length - 1]!;
  const alive = last === today || last === addDays(today, -1);
  return { current: alive ? run : 0, longest, latestRun: run, lastActiveDay: last };
}

/** Whether a stored streak is still alive today. */
export function liveStreak(
  stored: { currentLength: number; lastActiveDate: Date | null },
  today: string,
) {
  if (!stored.lastActiveDate) return 0;
  const last = dateToDay(stored.lastActiveDate);
  return last === today || last === addDays(today, -1) ? stored.currentLength : 0;
}
