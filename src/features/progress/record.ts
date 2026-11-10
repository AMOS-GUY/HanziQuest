/**
 * Applies the consequences of learning events — mastery, review schedule, XP, daily goal,
 * streak and achievements — inside the caller's transaction. Every XP grant has an
 * idempotency key, and the per-learner advisory lock serialises concurrent updates.
 */
import type { Prisma } from "@/generated/prisma/client";
import type {
  AttemptResult,
  LearningSessionType,
  PracticeMode,
  XPReason,
} from "@/generated/prisma/enums";
import { computeStreak, dateToDay, dayToDate, localDay } from "./calendar";
import { replayCharacter } from "./mastery";
import { XP, attemptXp } from "./xp-rules";

type Tx = Prisma.TransactionClient;

export interface ProgressDelta {
  xpAwarded: number;
  dailyGoalReached: boolean;
  streak: number;
  achievements: { key: string; name: string }[];
}

interface LearnerContext {
  userId: string;
  timezone: string;
  dailyGoalXp: number;
}

/** Serialises progress updates for one learner for the rest of the transaction. */
export async function lockLearner(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
}

async function learnerContext(tx: Tx, userId: string): Promise<LearnerContext> {
  const profile = await tx.profile.findUnique({
    where: { userId },
    select: { timezone: true, dailyGoalXp: true },
  });
  return { userId, timezone: profile?.timezone ?? "UTC", dailyGoalXp: profile?.dailyGoalXp ?? 30 };
}

/** Recomputes mastery and the review schedule for one character from its full history. */
export async function recomputeCharacter(tx: Tx, userId: string, characterId: string) {
  const events = await tx.attemptCharacterResult.findMany({
    where: { userId, characterId },
    select: { occurredAt: true, mode: true, result: true, techniqueOk: true },
  });
  const replay = replayCharacter(events);
  if (!replay) return null;
  const { mastery, review } = replay;
  await tx.characterMastery.upsert({
    where: { userId_characterId: { userId, characterId } },
    create: { userId, characterId, ...mastery },
    update: mastery,
  });
  await tx.reviewSchedule.upsert({
    where: { userId_characterId: { userId, characterId } },
    create: { userId, characterId, ...review },
    update: review,
  });
  return replay;
}

/** Grants XP once per idempotency key and books it on the learner's local day. */
async function grantXp(
  tx: Tx,
  ctx: LearnerContext,
  grant: {
    amount: number;
    reason: XPReason;
    key: string;
    day: string;
    sourceType?: string;
    sourceId?: string;
  },
): Promise<{ awarded: boolean; goalReached: boolean }> {
  if (grant.amount <= 0) return { awarded: false, goalReached: false };
  const inserted = await tx.xPTransaction.createMany({
    data: [
      {
        userId: ctx.userId,
        amount: grant.amount,
        reason: grant.reason,
        idempotencyKey: grant.key,
        sourceType: grant.sourceType ?? null,
        sourceId: grant.sourceId ?? null,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) return { awarded: false, goalReached: false };
  const date = dayToDate(grant.day);
  const activity = await tx.dailyActivity.upsert({
    where: { userId_date: { userId: ctx.userId, date } },
    create: { userId: ctx.userId, date, xpEarned: grant.amount },
    update: { xpEarned: { increment: grant.amount } },
  });
  let goalReached = false;
  if (!activity.goalMet && activity.xpEarned >= ctx.dailyGoalXp) {
    await tx.dailyActivity.update({
      where: { userId_date: { userId: ctx.userId, date } },
      data: { goalMet: true },
    });
    goalReached = true;
    await grantXp(tx, ctx, {
      amount: XP.dailyGoalBonus,
      reason: "DAILY_GOAL_MET",
      key: `goal:${ctx.userId}:${grant.day}`,
      day: grant.day,
      sourceType: "daily_goal",
    });
  }
  return { awarded: true, goalReached };
}

async function recomputeStreak(tx: Tx, ctx: LearnerContext, now: Date) {
  const rows = await tx.dailyActivity.findMany({
    where: { userId: ctx.userId, exercisesCompleted: { gt: 0 } },
    orderBy: { date: "desc" },
    take: 800,
    select: { date: true },
  });
  const summary = computeStreak(
    rows.map((r) => dateToDay(r.date)),
    localDay(now, ctx.timezone),
  );
  const lastActiveDate = summary.lastActiveDay ? dayToDate(summary.lastActiveDay) : null;
  const existing = await tx.streak.findUnique({ where: { userId: ctx.userId } });
  const longest = Math.max(summary.longest, existing?.longestLength ?? 0);
  await tx.streak.upsert({
    where: { userId: ctx.userId },
    create: {
      userId: ctx.userId,
      currentLength: summary.latestRun,
      longestLength: longest,
      lastActiveDate,
    },
    update: { currentLength: summary.latestRun, longestLength: longest, lastActiveDate },
  });
  return { current: summary.current, longest };
}

interface Criteria {
  type: "characters_written" | "lessons_completed" | "characters_learned" | "streak";
  count?: number;
  days?: number;
}

/** Awards any achievement whose criteria are now met. Each is earned at most once. */
async function checkAchievements(tx: Tx, ctx: LearnerContext, longestStreak: number, day: string) {
  const [all, earned] = await Promise.all([
    tx.achievement.findMany({ where: { active: true } }),
    tx.userAchievement.findMany({ where: { userId: ctx.userId }, select: { achievementId: true } }),
  ]);
  const have = new Set(earned.map((e) => e.achievementId));
  const pending = all.filter((a) => !have.has(a.id));
  if (pending.length === 0) return [];

  const counts = new Map<Criteria["type"], () => Promise<number>>([
    [
      "characters_written",
      async () =>
        (
          await tx.attemptCharacterResult.groupBy({
            by: ["characterId"],
            where: {
              userId: ctx.userId,
              mode: "INDEPENDENT",
              result: { in: ["EXCELLENT", "GOOD"] },
            },
          })
        ).length,
    ],
    [
      "lessons_completed",
      () => tx.lessonProgress.count({ where: { userId: ctx.userId, status: "COMPLETED" } }),
    ],
    [
      "characters_learned",
      () =>
        tx.characterMastery.count({
          where: { userId: ctx.userId, level: { in: ["FAMILIAR", "MASTERED"] } },
        }),
    ],
    ["streak", () => Promise.resolve(longestStreak)],
  ]);
  const cache = new Map<string, number>();
  const awarded: { key: string; name: string }[] = [];
  for (const a of pending) {
    const c = a.criteria as unknown as Criteria;
    const counter = counts.get(c.type);
    if (!counter) continue;
    if (!cache.has(c.type)) cache.set(c.type, await counter());
    const value = cache.get(c.type)!;
    if (value < (c.count ?? c.days ?? Infinity)) continue;
    await tx.userAchievement.create({ data: { userId: ctx.userId, achievementId: a.id } });
    await grantXp(tx, ctx, {
      amount: a.xpReward,
      reason: "ACHIEVEMENT_EARNED",
      key: `achievement:${ctx.userId}:${a.key}`,
      day,
      sourceType: "achievement",
      sourceId: a.id,
    });
    awarded.push({ key: a.key, name: a.name });
  }
  return awarded;
}

export interface AttemptForProgress {
  id: string;
  userId: string;
  exerciseId: string;
  occurredAt: Date;
  mode: PracticeMode;
  result: AttemptResult;
  sessionType: LearningSessionType | null;
  characters: {
    characterId: string;
    result: AttemptResult;
    score: number | null;
    techniqueOk?: boolean | null;
  }[];
}

/** Records per-character results and applies all progress effects of a new attempt. */
export async function applyAttemptProgress(
  tx: Tx,
  attempt: AttemptForProgress,
  now: Date,
): Promise<ProgressDelta> {
  const ctx = await learnerContext(tx, attempt.userId);
  const day = localDay(attempt.occurredAt, ctx.timezone);

  if (attempt.characters.length > 0) {
    await tx.attemptCharacterResult.createMany({
      data: attempt.characters.map((c, position) => ({
        attemptId: attempt.id,
        position,
        userId: attempt.userId,
        characterId: c.characterId,
        mode: attempt.mode,
        result: c.result,
        score: c.score,
        techniqueOk: c.techniqueOk ?? null,
        occurredAt: attempt.occurredAt,
      })),
    });
  }

  if (attempt.result === "SKIPPED") {
    await tx.exerciseAttempt.update({
      where: { id: attempt.id },
      data: { localDate: dayToDate(day) },
    });
    return { xpAwarded: 0, dailyGoalReached: false, streak: 0, achievements: [] };
  }

  for (const characterId of new Set(attempt.characters.map((c) => c.characterId))) {
    await recomputeCharacter(tx, attempt.userId, characterId);
  }

  const [rewardedToday, todayXp] = await Promise.all([
    tx.exerciseAttempt.count({
      where: {
        userId: attempt.userId,
        exerciseId: attempt.exerciseId,
        localDate: dayToDate(day),
        xpAwarded: { gt: 0 },
      },
    }),
    tx.exerciseAttempt.aggregate({
      where: { userId: attempt.userId, localDate: dayToDate(day) },
      _sum: { xpAwarded: true },
    }),
  ]);
  const amount = attemptXp({
    result: attempt.result,
    mode: attempt.mode,
    techniqueFault: attempt.characters.some((c) => c.techniqueOk === false),
    rewardedToday,
    attemptXpToday: todayXp._sum.xpAwarded ?? 0,
  });

  await tx.dailyActivity.upsert({
    where: { userId_date: { userId: attempt.userId, date: dayToDate(day) } },
    create: { userId: attempt.userId, date: dayToDate(day), exercisesCompleted: 1 },
    update: { exercisesCompleted: { increment: 1 } },
  });
  const grant = await grantXp(tx, ctx, {
    amount,
    reason: attempt.sessionType === "REVIEW" ? "REVIEW_COMPLETED" : "EXERCISE_COMPLETED",
    key: `attempt:${attempt.id}`,
    day,
    sourceType: "attempt",
    sourceId: attempt.id,
  });
  await tx.exerciseAttempt.update({
    where: { id: attempt.id },
    data: { localDate: dayToDate(day), xpAwarded: grant.awarded ? amount : 0 },
  });

  const streak = await recomputeStreak(tx, ctx, now);
  const achievements = await checkAchievements(tx, ctx, streak.longest, day);
  return {
    xpAwarded: grant.awarded ? amount : 0,
    dailyGoalReached: grant.goalReached,
    streak: streak.current,
    achievements,
  };
}

/** XP and achievements for completing a lesson for the first time. Replays earn nothing. */
export async function applyLessonCompletion(
  tx: Tx,
  userId: string,
  lessonId: string,
  completedAt: Date,
): Promise<ProgressDelta> {
  const ctx = await learnerContext(tx, userId);
  const day = localDay(completedAt, ctx.timezone);
  const grant = await grantXp(tx, ctx, {
    amount: XP.lessonCompleted,
    reason: "LESSON_COMPLETED",
    key: `lesson:${userId}:${lessonId}`,
    day,
    sourceType: "lesson",
    sourceId: lessonId,
  });
  const streakRow = await tx.streak.findUnique({ where: { userId } });
  const achievements = await checkAchievements(tx, ctx, streakRow?.longestLength ?? 0, day);
  return {
    xpAwarded: grant.awarded ? XP.lessonCompleted : 0,
    dailyGoalReached: grant.goalReached,
    streak: streakRow?.currentLength ?? 0,
    achievements,
  };
}
