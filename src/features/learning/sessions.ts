import type { PrismaClient } from "@/generated/prisma/client";
import { DomainError } from "@/features/administration/services";
import { getLessonStatesForLevel } from "@/features/progression/lesson-states";
import { applyLessonCompletion, lockLearner, type ProgressDelta } from "@/features/progress/record";

export const MIN_ENGAGED_RATIO = 0.5;

/** Starts a lesson session. Refuses locked or unpublished lessons. */
export async function startLessonSession(prisma: PrismaClient, userId: string, lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, status: true, unit: { select: { levelId: true } } },
  });
  if (!lesson || lesson.status !== "PUBLISHED")
    throw new DomainError("not_found", "Lesson not found.");
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
    prisma.lessonExercise.findMany({ where: { lessonId }, select: { exerciseId: true } }),
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

/**
 * Characters whose review is due, each with the free-writing exercise used to review it.
 * Only characters taught in a published lesson are included.
 */
export async function getDueReviews(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
  limit = REVIEW_BATCH_SIZE,
) {
  const due = await prisma.reviewSchedule.findMany({
    where: {
      userId,
      dueAt: { lte: now },
      character: {
        exercises: {
          some: {
            type: "FREEHAND_WRITING",
            status: "PUBLISHED",
            lessons: { some: { lesson: { status: "PUBLISHED" } } },
          },
        },
      },
    },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: {
      dueAt: true,
      character: {
        select: {
          id: true,
          hanzi: true,
          exercises: {
            where: {
              type: "FREEHAND_WRITING",
              status: "PUBLISHED",
              lessons: { some: { lesson: { status: "PUBLISHED" } } },
            },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  return due.map((d) => ({
    characterId: d.character.id,
    hanzi: d.character.hanzi,
    dueAt: d.dueAt,
    exerciseId: d.character.exercises[0]!.id,
  }));
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
