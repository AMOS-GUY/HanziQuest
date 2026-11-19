/**
 * Learning measurement engine (M15-a). Reads stored history for one fixed signup-week cohort and
 * returns aggregates only (`CohortMetrics`).
 *
 * - Read-only: every query goes through `readOnlyClient`, which throws on any write, raw
 *   statement or transaction. Measurement can't change learning history.
 * - No new data: it uses attempt results, daily activity, lesson progress and placement records
 *   that the app already stores for learning.
 * - Bounded: learners are processed in batches; each learner's history becomes counts and is
 *   dropped before the next batch.
 * - "As of": only events up to `now` count, so a result can be reproduced.
 *
 * Not yet used by any page (D-079): showing results needs the owner's privacy approval, and the
 * analytics layer (`features/measurement/analytics.ts`) adds suppression on top.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { CharacterEvent } from "@/features/progress/mastery";
import { dateToDay } from "@/features/progress/calendar";
import { readOnlyClient } from "@/lib/database/read-only";
import { parseCohortWeek, type CohortWeek } from "./cohorts";
import {
  learnerCounts,
  MeasurementTotals,
  type CohortMetrics,
  type LearnerHistory,
} from "./metrics";
import { MEASURED_LEARNER } from "./population";

export interface CohortMeasurement {
  week: CohortWeek;
  asOf: Date;
  metrics: CohortMetrics;
}

export async function measureCohort(
  prisma: PrismaClient,
  week: CohortWeek,
  options: { now?: Date; batchSize?: number } = {},
): Promise<CohortMeasurement> {
  const range = parseCohortWeek(week);
  if (!range) throw new Error(`Not a cohort week: ${week}`);
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 200;
  const db = readOnlyClient(prisma);

  const learners = await db.user.findMany({
    where: { ...MEASURED_LEARNER, createdAt: { gte: range.start, lt: range.end, lte: now } },
    select: {
      id: true,
      createdAt: true,
      profile: { select: { timezone: true, onboardingCompletedAt: true } },
    },
    orderBy: { id: "asc" },
  });

  const totals = new MeasurementTotals();
  for (let i = 0; i < learners.length; i += batchSize) {
    const batch = learners.slice(i, i + batchSize);
    const ids = batch.map((l) => l.id);
    const [results, activity, completed, placements, testedOut, started, placementStarts] =
      await Promise.all([
        db.attemptCharacterResult.findMany({
          where: { userId: { in: ids }, occurredAt: { lte: now }, result: { not: "SKIPPED" } },
          select: {
            userId: true,
            characterId: true,
            mode: true,
            result: true,
            techniqueOk: true,
            occurredAt: true,
          },
        }),
        db.dailyActivity.findMany({
          where: { userId: { in: ids }, exercisesCompleted: { gt: 0 } },
          select: { userId: true, date: true },
        }),
        db.lessonProgress.findMany({
          where: { userId: { in: ids }, status: "COMPLETED", completedAt: { not: null, lte: now } },
          select: { userId: true, completedAt: true },
        }),
        db.placementAssessment.findMany({
          where: { userId: { in: ids }, status: "COMPLETED", completedAt: { not: null, lte: now } },
          select: { userId: true, completedAt: true },
          orderBy: { completedAt: "asc" },
        }),
        db.lessonProgress.findMany({
          where: { userId: { in: ids }, status: "TESTED_OUT" },
          select: {
            userId: true,
            lesson: {
              select: { characters: { where: { isNew: true }, select: { characterId: true } } },
            },
          },
        }),
        db.lessonProgress.findMany({
          where: {
            userId: { in: ids },
            status: { in: ["IN_PROGRESS", "COMPLETED"] },
            startedAt: { lte: now },
          },
          select: { userId: true },
          distinct: ["userId"],
        }),
        db.placementAssessment.findMany({
          where: { userId: { in: ids }, startedAt: { lte: now } },
          select: { userId: true },
          distinct: ["userId"],
        }),
      ]);

    const byUser = new Map<string, Map<string, CharacterEvent[]>>();
    for (const r of results) {
      const chars = byUser.get(r.userId) ?? new Map<string, CharacterEvent[]>();
      byUser.set(r.userId, chars);
      const list = chars.get(r.characterId) ?? [];
      chars.set(r.characterId, list);
      list.push({
        occurredAt: r.occurredAt,
        mode: r.mode,
        result: r.result,
        techniqueOk: r.techniqueOk,
      });
    }
    const days = new Map<string, Set<string>>();
    for (const a of activity) {
      const set = days.get(a.userId) ?? new Set<string>();
      days.set(a.userId, set);
      set.add(dateToDay(a.date));
    }
    const firstLesson = new Map<string, Date>();
    for (const p of completed) {
      const prev = firstLesson.get(p.userId);
      if (!prev || p.completedAt! < prev) firstLesson.set(p.userId, p.completedAt!);
    }
    const placementAt = new Map<string, Date>();
    for (const p of placements)
      if (!placementAt.has(p.userId)) placementAt.set(p.userId, p.completedAt!);
    const tested = new Map<string, Set<string>>();
    for (const t of testedOut) {
      const set = tested.get(t.userId) ?? new Set<string>();
      tested.set(t.userId, set);
      for (const c of t.lesson.characters) set.add(c.characterId);
    }

    const lessonStarted = new Set(started.map((x) => x.userId));
    const placementStarted = new Set(placementStarts.map((x) => x.userId));

    for (const l of batch) {
      const placed = placementAt.get(l.id);
      const history: LearnerHistory = {
        createdAt: l.createdAt,
        timezone: l.profile?.timezone ?? "UTC",
        activeDays: days.get(l.id) ?? new Set(),
        firstLessonCompletedAt: firstLesson.get(l.id) ?? null,
        onboardedAt:
          l.profile?.onboardingCompletedAt && l.profile.onboardingCompletedAt <= now
            ? l.profile.onboardingCompletedAt
            : null,
        startedPlacement: placementStarted.has(l.id),
        startedLesson: lessonStarted.has(l.id),
        characters: byUser.get(l.id) ?? new Map(),
        placement: placed
          ? { completedAt: placed, testedOut: tested.get(l.id) ?? new Set() }
          : null,
      };
      totals.add(learnerCounts(history, now));
    }
  }
  return { week, asOf: now, metrics: totals.result() };
}
