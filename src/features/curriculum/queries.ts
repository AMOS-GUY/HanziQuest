import "server-only";
import { prisma } from "@/lib/database/prisma";
import { getLessonStatesForLevel, type LessonState } from "@/features/progression/lesson-states";

/** Published learning path: curricula → levels → units → published lessons (learner-facing). */
export async function getLearningPath() {
  return prisma.curriculum.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      verification: true,
      levels: {
        orderBy: { level: "asc" },
        select: {
          id: true,
          level: true,
          name: true,
          units: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              slug: true,
              title: true,
              description: true,
              lessons: {
                where: { status: "PUBLISHED" },
                orderBy: { position: "asc" },
                select: {
                  id: true,
                  slug: true,
                  title: true,
                  _count: { select: { vocabulary: true, exercises: true } },
                  characters: {
                    where: { isNew: true },
                    orderBy: { position: "asc" },
                    select: { character: { select: { hanzi: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

export type LearningPath = Awaited<ReturnType<typeof getLearningPath>>;

/** Learning path plus this learner's derived lesson states and the next lesson to work on. */
export async function getLearnerPath(userId: string) {
  const path = await getLearningPath();
  const states = new Map<string, LessonState>();
  let next: { id: string; title: string } | null = null;
  let completed = 0;
  let total = 0;
  for (const curriculum of path) {
    for (const level of curriculum.levels) {
      const result = await getLessonStatesForLevel(prisma, userId, level.id);
      for (const lesson of result.lessons) {
        const state = result.states.get(lesson.id)!;
        states.set(lesson.id, state);
        total += 1;
        if (state === "COMPLETED" || state === "TESTED_OUT") completed += 1;
        if (!next && (state === "AVAILABLE" || state === "IN_PROGRESS"))
          next = { id: lesson.id, title: lesson.title };
      }
    }
  }
  return { path, states, next, completed, total };
}
