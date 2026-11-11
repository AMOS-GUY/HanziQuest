import type { PrismaClient } from "@/generated/prisma/client";
import type { MasteryLevel } from "@/generated/prisma/enums";
import { LEARNER_REVIEWABLE_CHARACTER } from "@/features/curriculum/visibility";
import { countPlacementChecks } from "@/features/learning/sessions";
import { addDays, dateToDay, dayToDate, liveStreak, localDay } from "./calendar";

export interface ProgressSummary {
  xpTotal: number;
  today: { day: string; xp: number; goal: number; goalMet: boolean };
  streak: { current: number; longest: number };
  /** Scheduled reviews due now plus placement checks (see `getPlacementChecks`). */
  dueNow: number;
  dueNext: Date | null;
  mastery: Record<MasteryLevel, number>;
}

/** Compact numbers for Home and the top of Progress. */
export async function getProgressSummary(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<ProgressSummary> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { timezone: true, dailyGoalXp: true },
  });
  const timezone = profile?.timezone ?? "UTC";
  const day = localDay(now, timezone);
  const [xp, activity, streak, dueNow, next, levels] = await Promise.all([
    prisma.xPTransaction.aggregate({ where: { userId }, _sum: { amount: true } }),
    prisma.dailyActivity.findUnique({ where: { userId_date: { userId, date: dayToDate(day) } } }),
    prisma.streak.findUnique({ where: { userId } }),
    Promise.all([
      prisma.reviewSchedule.count({
        where: { userId, dueAt: { lte: now }, character: LEARNER_REVIEWABLE_CHARACTER },
      }),
      countPlacementChecks(prisma, userId),
    ]).then(([scheduled, placement]) => scheduled + placement),
    prisma.reviewSchedule.findFirst({
      where: { userId, dueAt: { gt: now }, character: LEARNER_REVIEWABLE_CHARACTER },
      orderBy: { dueAt: "asc" },
      select: { dueAt: true },
    }),
    prisma.characterMastery.groupBy({ by: ["level"], where: { userId }, _count: true }),
  ]);
  const mastery: Record<MasteryLevel, number> = { NEW: 0, LEARNING: 0, FAMILIAR: 0, MASTERED: 0 };
  for (const l of levels) mastery[l.level] = l._count;
  return {
    xpTotal: xp._sum.amount ?? 0,
    today: {
      day,
      xp: activity?.xpEarned ?? 0,
      goal: profile?.dailyGoalXp ?? 30,
      goalMet: activity?.goalMet ?? false,
    },
    streak: {
      current: streak ? liveStreak(streak, day) : 0,
      longest: streak?.longestLength ?? 0,
    },
    dueNow,
    dueNext: next?.dueAt ?? null,
    mastery,
  };
}

/** Full Progress screen data. */
export async function getProgressDetails(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
) {
  const summary = await getProgressSummary(prisma, userId, now);
  const firstDay = addDays(summary.today.day, -13);
  const [days, achievements, earned, characters] = await Promise.all([
    prisma.dailyActivity.findMany({
      where: { userId, date: { gte: dayToDate(firstDay) } },
      select: { date: true, xpEarned: true, goalMet: true, exercisesCompleted: true },
    }),
    prisma.achievement.findMany({ where: { active: true }, orderBy: { xpReward: "asc" } }),
    prisma.userAchievement.findMany({ where: { userId } }),
    prisma.characterMastery.findMany({
      where: { userId },
      orderBy: [{ level: "desc" }, { lastPracticedAt: "desc" }],
      select: {
        level: true,
        strength: true,
        lastTechniqueOk: true,
        guidedAttempts: true,
        independentAttempts: true,
        independentSuccesses: true,
        techniqueAttempts: true,
        techniqueClean: true,
        character: { select: { hanzi: true, pinyin: true, meaning: true } },
      },
    }),
  ]);
  const byDay = new Map(days.map((d) => [dateToDay(d.date), d]));
  const recent = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(firstDay, i);
    const d = byDay.get(day);
    return {
      day,
      xp: d?.xpEarned ?? 0,
      goalMet: d?.goalMet ?? false,
      exercises: d?.exercisesCompleted ?? 0,
    };
  });
  const earnedAt = new Map(earned.map((e) => [e.achievementId, e.earnedAt]));
  return {
    summary,
    recent,
    achievements: achievements.map((a) => ({
      key: a.key,
      name: a.name,
      description: a.description,
      icon: a.icon,
      earnedAt: earnedAt.get(a.id) ?? null,
    })),
    characters: characters.map((c) => ({
      ...c.character,
      level: c.level,
      strength: c.strength,
      techniqueNeedsWork: c.lastTechniqueOk === false,
      guidedAttempts: c.guidedAttempts,
      recall: { attempts: c.independentAttempts, successes: c.independentSuccesses },
      technique: { judged: c.techniqueAttempts, clean: c.techniqueClean },
    })),
    skills: skillTotals(characters),
  };
}

/** Upcoming review load per day for the next week, in the learner's timezone. */
export async function getReviewForecast(
  prisma: PrismaClient,
  userId: string,
  timezone: string,
  now: Date = new Date(),
) {
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.reviewSchedule.findMany({
    where: { userId, dueAt: { gt: now, lte: horizon }, character: LEARNER_REVIEWABLE_CHARACTER },
    select: { dueAt: true },
  });
  const today = localDay(now, timezone);
  const counts = new Map<string, number>();
  for (const r of rows) {
    const d = localDay(r.dueAt, timezone);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    return { day, count: counts.get(day) ?? 0 };
  });
}

/**
 * Separate measures of what the learner can do (M7): recall (independent writing of the right
 * character), technique (stroke order and direction on those recalls) and guided practice
 * (tracing, never counted as recall). Rates are null until there is something to measure.
 */
export function skillTotals(
  rows: readonly {
    guidedAttempts: number;
    independentAttempts: number;
    independentSuccesses: number;
    techniqueAttempts: number;
    techniqueClean: number;
  }[],
) {
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
  const recallAttempts = sum((r) => r.independentAttempts);
  const recallSuccesses = sum((r) => r.independentSuccesses);
  const techniqueJudged = sum((r) => r.techniqueAttempts);
  const techniqueClean = sum((r) => r.techniqueClean);
  return {
    guidedAttempts: sum((r) => r.guidedAttempts),
    recallAttempts,
    recallRate: recallAttempts > 0 ? recallSuccesses / recallAttempts : null,
    techniqueJudged,
    techniqueRate: techniqueJudged > 0 ? techniqueClean / techniqueJudged : null,
  };
}
