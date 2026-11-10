import type { Prisma } from "@/generated/prisma/client";

/**
 * What learners may see: a PUBLISHED lesson inside a PUBLISHED curriculum. Archiving or
 * unpublishing a curriculum hides all of its lessons, exercises and reviews from learners,
 * including through direct links, offline downloads and the API. Use this fragment for every
 * learner-facing lesson query instead of checking `lesson.status` alone.
 */
export const LEARNER_VISIBLE_LESSON = {
  status: "PUBLISHED",
  unit: { level: { curriculum: { status: "PUBLISHED" } } },
} as const satisfies Prisma.LessonWhereInput;

/** Select fragment for `isLearnerVisible`. */
export const VISIBILITY_SELECT = {
  status: true,
  unit: { select: { level: { select: { curriculum: { select: { status: true } } } } } },
} as const;

export function isLearnerVisible(lesson: {
  status: string;
  unit: { level: { curriculum: { status: string } } };
}) {
  return lesson.status === "PUBLISHED" && lesson.unit.level.curriculum.status === "PUBLISHED";
}
