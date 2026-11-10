import type { PrismaClient } from "@/generated/prisma/client";

export type LessonState = "LOCKED" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETED" | "TESTED_OUT";

export interface OrderedLesson {
  id: string;
}

/**
 * Derives lesson states for one learner over an ordered list of lessons (curriculum order).
 * Rules: the first lesson is always available; a lesson unlocks when the previous lesson is
 * COMPLETED or TESTED_OUT; any lesson with recorded progress stays open.
 */
export function deriveLessonStates(
  lessons: readonly OrderedLesson[],
  progress: ReadonlyMap<string, "IN_PROGRESS" | "COMPLETED" | "TESTED_OUT">,
): Map<string, LessonState> {
  const states = new Map<string, LessonState>();
  let previousDone = true;
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
    where: { status: "PUBLISHED", unit: { levelId } },
    orderBy: [{ unit: { position: "asc" } }, { position: "asc" }],
    select: { id: true, title: true, unitId: true },
  });
}

export async function getLessonStatesForLevel(
  prisma: PrismaClient,
  userId: string,
  levelId: string,
) {
  const lessons = await orderedLevelLessons(prisma, levelId);
  const progress = await prisma.lessonProgress.findMany({
    where: { userId, lessonId: { in: lessons.map((l) => l.id) } },
    select: { lessonId: true, status: true },
  });
  return {
    lessons,
    states: deriveLessonStates(lessons, new Map(progress.map((p) => [p.lessonId, p.status]))),
  };
}

export async function getLessonState(
  prisma: PrismaClient,
  userId: string,
  lessonId: string,
): Promise<LessonState | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { status: true, unit: { select: { levelId: true } } },
  });
  if (!lesson || lesson.status !== "PUBLISHED") return null;
  const { states } = await getLessonStatesForLevel(prisma, userId, lesson.unit.levelId);
  return states.get(lessonId) ?? null;
}
