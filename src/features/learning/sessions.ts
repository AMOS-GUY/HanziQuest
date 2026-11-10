import type { PrismaClient } from "@/generated/prisma/client";
import { DomainError } from "@/features/administration/services";
import { getLessonStatesForLevel } from "@/features/progression/lesson-states";

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
  if (!session || session.userId !== userId || !session.lessonId)
    throw new DomainError("not_found", "Session not found.");
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
  await prisma.$transaction(async (tx) => {
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
    }
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
  return { lessonId, nextLessonId: next?.id ?? null };
}
