import type { PrismaClient } from "@/generated/prisma/client";
import { DomainError } from "@/features/administration/services";
import {
  isLearnerVisible,
  LEARNER_REVIEWABLE_CHARACTER,
  LEARNER_VISIBLE_LESSON,
  VISIBILITY_SELECT,
} from "@/features/curriculum/visibility";
import { getLessonStatesForLevel } from "@/features/progression/lesson-states";
import { applyLessonCompletion, lockLearner, type ProgressDelta } from "@/features/progress/record";

export const MIN_ENGAGED_RATIO = 0.5;

/** Starts a lesson session. Refuses locked or unpublished lessons. */
export async function startLessonSession(prisma: PrismaClient, userId: string, lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      status: true,
      unit: { select: { levelId: true, ...VISIBILITY_SELECT.unit.select } },
    },
  });
  if (!lesson || !isLearnerVisible(lesson)) throw new DomainError("not_found", "Lesson not found.");
  const { states } = await getLessonStatesForLevel(prisma, userId, lesson.unit.levelId);
  if (states.get(lessonId) === "LOCKED")
    throw new DomainError("forbidden", "Complete the previous lesson first.");

  return prisma.$transaction(async (tx) => {
    const session = await tx.learningSession.create({ data: { userId, lessonId, type: "LESSON" } });
    await tx.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId, status: "IN_PROGRESS" },
      update: {},
    });
    return session;
  });
}

/**
 * Completes a lesson session once every exercise in the lesson has at least one attempt
 * recorded in this session. Idempotent.
 */
export async function completeLessonSession(
  prisma: PrismaClient,
  userId: string,
  sessionId: string,
) {
  const session = await prisma.learningSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId)
    throw new DomainError("not_found", "Session not found.");
  if (session.type === "REVIEW") {
    if (!session.endedAt) {
      const now = new Date();
      await prisma.learningSession.update({
        where: { id: sessionId },
        data: { endedAt: now, completedAt: now },
      });
    }
    return { lessonId: null, nextLessonId: null, progress: null };
  }
  if (!session.lessonId) throw new DomainError("not_found", "Session not found.");
  const lessonId = session.lessonId;

  const [exercises, attempts] = await Promise.all([
    // Only published exercises are shown to learners, so only they are required.
    prisma.lessonExercise.findMany({
      where: { lessonId, exercise: { status: "PUBLISHED" } },
      select: { exerciseId: true },
    }),
    prisma.exerciseAttempt.findMany({
      where: { sessionId, userId },
      select: { exerciseId: true, result: true },
    }),
  ]);
  const done = new Set(attempts.map((a) => a.exerciseId));
  const remaining = exercises.filter((e) => !done.has(e.exerciseId)).length;
  if (remaining > 0) {
    throw new DomainError(
      "conflict",
      `${remaining} exercise${remaining === 1 ? "" : "s"} still to do.`,
    );
  }
  // Skipping stays available (e.g. for learners who cannot draw), but a lesson only counts as
  // completed when at least half of its exercises were genuinely attempted.
  const engaged = new Set(attempts.filter((a) => a.result !== "SKIPPED").map((a) => a.exerciseId));
  if (engaged.size < Math.ceil(exercises.length * MIN_ENGAGED_RATIO)) {
    throw new DomainError(
      "conflict",
      "Too many exercises were skipped to complete this lesson. Try a few more, then finish again.",
    );
  }

  const now = new Date();
  const progress: ProgressDelta | null = await prisma.$transaction(async (tx) => {
    await lockLearner(tx, userId);
    if (!session.completedAt) {
      await tx.learningSession.update({
        where: { id: sessionId },
        data: { completedAt: now, endedAt: now },
      });
    }
    const progress = await tx.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
    if (progress?.status !== "COMPLETED") {
      await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId } },
        create: { userId, lessonId, status: "COMPLETED", completedAt: now },
        update: { status: "COMPLETED", completedAt: progress?.completedAt ?? now },
      });
      return applyLessonCompletion(tx, userId, lessonId, now);
    }
    return null;
  });

  const lesson = await prisma.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    select: { unit: { select: { levelId: true } } },
  });
  const { lessons, states } = await getLessonStatesForLevel(prisma, userId, lesson.unit.levelId);
  const next = lessons.find((l) => {
    const s = states.get(l.id);
    return s === "AVAILABLE" || s === "IN_PROGRESS";
  });
  return { lessonId, nextLessonId: next?.id ?? null, progress };
}

export const REVIEW_BATCH_SIZE = 10;

const REVIEW_EXERCISE_SELECT = {
  where: {
    type: "FREEHAND_WRITING",
    status: "PUBLISHED",
    lessons: { some: { lesson: LEARNER_VISIBLE_LESSON } },
  },
  take: 1,
  select: { id: true },
} as const;

export interface DueReview {
  characterId: string;
  hanzi: string;
  /** For a placement check: when it became due (now). */
  dueAt: Date;
  exerciseId: string;
  /**
   * "scheduled": the spaced-repetition schedule says it is due.
   * "placement": introduced in a lesson the learner tested out of by placement and never
   * written yet. Placement only checked recognition, so recall is confirmed here once.
   */
  kind: "scheduled" | "placement";
}

/**
 * Characters from lessons the learner tested out of by placement that they have never written
 * (no review schedule yet), in curriculum order. They are due now. Writing one creates its
 * schedule through the normal replay (`recomputeCharacter`), which removes it from this list;
 * nothing here writes mastery or schedules (D-044).
 */
function placementCheckWhere(userId: string) {
  return {
    ...LEARNER_REVIEWABLE_CHARACTER,
    reviewSchedules: { none: { userId } },
    lessons: {
      some: {
        isNew: true,
        lesson: { ...LEARNER_VISIBLE_LESSON, progress: { some: { userId, status: "TESTED_OUT" } } },
      },
    },
  } as const;
}

export async function countPlacementChecks(prisma: PrismaClient, userId: string) {
  return prisma.character.count({ where: placementCheckWhere(userId) });
}

export async function getPlacementChecks(
  prisma: PrismaClient,
  userId: string,
  now: Date,
  limit: number,
): Promise<DueReview[]> {
  if (limit <= 0) return [];
  const rows = await prisma.lessonCharacter.findMany({
    where: {
      isNew: true,
      lesson: { ...LEARNER_VISIBLE_LESSON, progress: { some: { userId, status: "TESTED_OUT" } } },
      character: placementCheckWhere(userId),
    },
    orderBy: [
      { lesson: { unit: { level: { level: "asc" } } } },
      { lesson: { unit: { position: "asc" } } },
      { lesson: { position: "asc" } },
      { position: "asc" },
    ],
    select: {
      character: { select: { id: true, hanzi: true, exercises: REVIEW_EXERCISE_SELECT } },
    },
  });
  const seen = new Set<string>();
  const checks: DueReview[] = [];
  for (const { character } of rows) {
    if (seen.has(character.id) || !character.exercises[0]) continue;
    seen.add(character.id);
    checks.push({
      characterId: character.id,
      hanzi: character.hanzi,
      dueAt: now,
      exerciseId: character.exercises[0].id,
      kind: "placement",
    });
    if (checks.length >= limit) break;
  }
  return checks;
}

/**
 * What to review now, each with the free-writing exercise used to review it: scheduled reviews
 * that are due (most overdue first), then placement checks. Only characters taught in a lesson
 * the learner can see are included.
 */
export async function getDueReviews(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
  limit = REVIEW_BATCH_SIZE,
): Promise<DueReview[]> {
  const due = await prisma.reviewSchedule.findMany({
    where: { userId, dueAt: { lte: now }, character: LEARNER_REVIEWABLE_CHARACTER },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: {
      dueAt: true,
      character: { select: { id: true, hanzi: true, exercises: REVIEW_EXERCISE_SELECT } },
    },
  });
  const scheduled = due.map<DueReview>((d) => ({
    characterId: d.character.id,
    hanzi: d.character.hanzi,
    dueAt: d.dueAt,
    exerciseId: d.character.exercises[0]!.id,
    kind: "scheduled",
  }));
  return [
    ...scheduled,
    ...(await getPlacementChecks(prisma, userId, now, limit - scheduled.length)),
  ];
}

/** Starts a review session. Refused when nothing is due. */
export async function startReviewSession(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
) {
  const due = await getDueReviews(prisma, userId, now);
  if (due.length === 0) throw new DomainError("conflict", "Nothing is due for review right now.");
  const session = await prisma.learningSession.create({ data: { userId, type: "REVIEW" } });
  return { session, due };
}
