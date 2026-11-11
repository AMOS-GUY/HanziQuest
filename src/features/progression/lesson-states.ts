import type { PrismaClient } from "@/generated/prisma/client";
import { isLearnerVisible, LEARNER_VISIBLE_LESSON } from "@/features/curriculum/visibility";

export type LessonState = "LOCKED" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETED" | "TESTED_OUT";

export interface OrderedLesson {
  id: string;
}

/**
 * Derives lesson states for one learner over an ordered list of lessons (curriculum order).
 * Rules: the first lesson is available when `firstUnlocked` (the level is the first one, or
 * the previous level is finished); a lesson unlocks when the previous lesson is COMPLETED or
 * TESTED_OUT; any lesson with recorded progress stays open.
 */
export function deriveLessonStates(
  lessons: readonly OrderedLesson[],
  progress: ReadonlyMap<string, "IN_PROGRESS" | "COMPLETED" | "TESTED_OUT">,
  firstUnlocked = true,
): Map<string, LessonState> {
  const states = new Map<string, LessonState>();
  let previousDone = firstUnlocked;
  for (const lesson of lessons) {
    const p = progress.get(lesson.id);
    const state: LessonState = p ?? (previousDone ? "AVAILABLE" : "LOCKED");
    states.set(lesson.id, state);
    previousDone = state === "COMPLETED" || state === "TESTED_OUT";
  }
  return states;
}

/** Published lessons of a level in curriculum order (unit position, then lesson position). */
export async function orderedLevelLessons(prisma: PrismaClient, levelId: string) {
  return prisma.lesson.findMany({
    where: { ...LEARNER_VISIBLE_LESSON, unit: { ...LEARNER_VISIBLE_LESSON.unit, levelId } },
    orderBy: [{ unit: { position: "asc" } }, { position: "asc" }],
    select: { id: true, title: true, unitId: true },
  });
}

/**
 * Whether a level's first lesson is unlocked: always for the first level of a curriculum that
 * has learner-visible lessons; otherwise only when the last visible lesson of the closest lower
 * level is COMPLETED or TESTED_OUT (M7, D-039). Levels are sequential, like lessons.
 */
export async function isLevelUnlocked(prisma: PrismaClient, userId: string, levelId: string) {
  const level = await prisma.hSKLevel.findUnique({
    where: { id: levelId },
    select: { level: true, curriculumId: true },
  });
  if (!level) return false;
  const previous = await prisma.hSKLevel.findFirst({
    where: {
      curriculumId: level.curriculumId,
      level: { lt: level.level },
      units: { some: { lessons: { some: LEARNER_VISIBLE_LESSON } } },
    },
    orderBy: { level: "desc" },
    select: { id: true },
  });
  if (!previous) return true;
  const last = await prisma.lesson.findFirst({
    where: {
      ...LEARNER_VISIBLE_LESSON,
      unit: { ...LEARNER_VISIBLE_LESSON.unit, levelId: previous.id },
    },
    orderBy: [{ unit: { position: "desc" } }, { position: "desc" }],
    select: { id: true },
  });
  if (!last) return true;
  const progress = await prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId: last.id } },
    select: { status: true },
  });
  return progress?.status === "COMPLETED" || progress?.status === "TESTED_OUT";
}

export async function getLessonStatesForLevel(
  prisma: PrismaClient,
  userId: string,
  levelId: string,
) {
  const [lessons, firstUnlocked] = await Promise.all([
    orderedLevelLessons(prisma, levelId),
    isLevelUnlocked(prisma, userId, levelId),
  ]);
  const progress = await prisma.lessonProgress.findMany({
    where: { userId, lessonId: { in: lessons.map((l) => l.id) } },
    select: { lessonId: true, status: true },
  });
  return {
    lessons,
    states: deriveLessonStates(
      lessons,
      new Map(progress.map((p) => [p.lessonId, p.status])),
      firstUnlocked,
    ),
  };
}

export async function getLessonState(
  prisma: PrismaClient,
  userId: string,
  lessonId: string,
): Promise<LessonState | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      status: true,
      unit: {
        select: { levelId: true, level: { select: { curriculum: { select: { status: true } } } } },
      },
    },
  });
  if (!lesson || !isLearnerVisible(lesson)) return null;
  const { states } = await getLessonStatesForLevel(prisma, userId, lesson.unit.levelId);
  return states.get(lessonId) ?? null;
}
