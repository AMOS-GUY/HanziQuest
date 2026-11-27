/**
 * Attempt context (D-085, M18). Decides, on the server, the three things a client must never
 * decide for an attempt:
 *
 *  - F-06 · Session: an attempt naming a session must fit it. The learner owns it, it isn't
 *    finished, and the exercise is part of its lesson (or, for a review session, the character
 *    is one the learner is reviewing).
 *  - F-01 · Eligibility: an attempt counts for progression only if the learner has reached the
 *    content. Otherwise it is preview practice: graded and stored, but with no progress effects.
 *  - F-02 · Time: online attempts take the server's time. Offline attempts keep the device's
 *    time only after the server-recorded start of offline access (the session start, or the
 *    lesson's first download on that device); with no such record the server's time is used.
 *
 * Nothing here reads client flags (`preview`, `locked`, …): the attempt schema strips unknown
 * fields, and every decision comes from the database.
 */
import type { LearningSession, PrismaClient } from "@/generated/prisma/client";
import type { LearningSessionType } from "@/generated/prisma/enums";
import { DomainError } from "@/features/administration/services";
import {
  LEARNER_REVIEWABLE_CHARACTER,
  LEARNER_VISIBLE_LESSON,
} from "@/features/curriculum/visibility";
import { getLessonStatesForLevel } from "@/features/progression/lesson-states";

/** Device clocks may run this far ahead or behind the server and still be accepted. */
export const OFFLINE_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Oldest offline attempt accepted, measured from its arrival. */
export const OFFLINE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** What `submitAttempt` knows about the exercise when it resolves the context. */
export interface ContextExercise {
  id: string;
  type: string;
  characterId: string | null;
  /** Characters the exercise asks for (from its evaluation config). */
  characters: readonly string[];
  /** Learner-visible lessons containing the exercise. */
  lessons: readonly { lessonId: string; levelId: string }[];
}

export interface AttemptContext {
  session: Pick<LearningSession, "id" | "type" | "lessonId" | "startedAt"> | null;
  sessionType: LearningSessionType | null;
  /** False: preview practice (graded, never counted). */
  countsForProgress: boolean;
  /** Authoritative event time for progression. */
  occurredAt: Date;
  /** What the client claimed, kept for diagnostics. */
  clientOccurredAt: Date;
}

/** F-06: the session named by an attempt must fit it. */
async function resolveSession(
  prisma: PrismaClient,
  userId: string,
  sessionId: string | undefined,
  lessonId: string | undefined,
  exercise: ContextExercise,
): Promise<AttemptContext["session"]> {
  const lessonIds = new Set(exercise.lessons.map((l) => l.lessonId));
  if (lessonId !== undefined && !lessonIds.has(lessonId))
    throw new DomainError("conflict", "This exercise isn't part of that lesson.");
  if (!sessionId) return null;

  const session = await prisma.learningSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      type: true,
      lessonId: true,
      startedAt: true,
      completedAt: true,
    },
  });
  if (!session || session.userId !== userId)
    throw new DomainError("not_found", "Session not found.");
  if (session.completedAt)
    throw new DomainError("conflict", "This practice session is already finished.");

  if (session.type === "LESSON") {
    if (!session.lessonId || !lessonIds.has(session.lessonId))
      throw new DomainError("conflict", "This exercise isn't part of the session's lesson.");
    if (lessonId !== undefined && lessonId !== session.lessonId)
      throw new DomainError("conflict", "The lesson doesn't match the session.");
  } else {
    // Review: a free-writing exercise for a character the learner is reviewing, i.e. one with a
    // schedule or a placement check (a tested-out lesson's new character, D-044).
    if (lessonId !== undefined)
      throw new DomainError("conflict", "A review isn't tied to a lesson.");
    if (
      exercise.type !== "FREEHAND_WRITING" ||
      !exercise.characterId ||
      !(await isReviewable(prisma, userId, exercise.characterId))
    )
      throw new DomainError("conflict", "This character isn't part of your reviews.");
  }
  return {
    id: session.id,
    type: session.type,
    lessonId: session.lessonId,
    startedAt: session.startedAt,
  };
}

async function isReviewable(prisma: PrismaClient, userId: string, characterId: string) {
  const found = await prisma.character.count({
    where: {
      id: characterId,
      ...LEARNER_REVIEWABLE_CHARACTER,
      OR: [
        { reviewSchedules: { some: { userId } } },
        {
          lessons: {
            some: {
              isNew: true,
              lesson: {
                ...LEARNER_VISIBLE_LESSON,
                progress: { some: { userId, status: "TESTED_OUT" } },
              },
            },
          },
        },
      ],
    },
  });
  return found > 0;
}

/**
 * F-01: an attempt counts when the learner has reached the content, under the existing lesson
 * states (any state but LOCKED, D-039): either a reached lesson contains the exercise, or every
 * character it asks for is taught in some reached, visible lesson. The second rule handles
 * characters shared across lessons and curricula: a character reached anywhere counts, whichever
 * curriculum's exercise free practice happens to use.
 */
export async function isProgressionEligible(
  prisma: PrismaClient,
  userId: string,
  exercise: ContextExercise,
): Promise<boolean> {
  const teaching = await prisma.lessonCharacter.findMany({
    where: {
      character: { hanzi: { in: [...exercise.characters] } },
      lesson: LEARNER_VISIBLE_LESSON,
    },
    select: {
      lessonId: true,
      character: { select: { hanzi: true } },
      lesson: { select: { unit: { select: { levelId: true } } } },
    },
  });
  const levelIds = new Set([
    ...exercise.lessons.map((l) => l.levelId),
    ...teaching.map((t) => t.lesson.unit.levelId),
  ]);
  const reached = new Set<string>();
  for (const levelId of levelIds) {
    const { states } = await getLessonStatesForLevel(prisma, userId, levelId);
    for (const [id, state] of states) if (state !== "LOCKED") reached.add(id);
  }
  if (exercise.lessons.some((l) => reached.has(l.lessonId))) return true;
  const reachedCharacters = new Set(
    teaching.filter((t) => reached.has(t.lessonId)).map((t) => t.character.hanzi),
  );
  return (
    exercise.characters.length > 0 && exercise.characters.every((c) => reachedCharacters.has(c))
  );
}

/**
 * F-02: the authoritative time of an attempt.
 *  - Online (`deviceId` absent): the server's time. A wrong browser clock never refuses an
 *    attempt and never moves progression.
 *  - Offline sync: the device's time, clamped to now, refused when older than 30 days or before
 *    the server-recorded start of offline access (minus clock skew). That start is the session's
 *    `startedAt` when the attempt names one, otherwise the device's first download of a lesson
 *    containing the exercise. With neither, there is no evidence the attempt happened earlier,
 *    so the server's time is used.
 */
export async function resolveAttemptTime(
  prisma: PrismaClient,
  input: { userId: string; clientTime: Date; now: Date; deviceId?: string },
  session: AttemptContext["session"],
  exercise: ContextExercise,
): Promise<Date> {
  const { clientTime, now, deviceId, userId } = input;
  if (!deviceId) return now;
  if (Number.isNaN(clientTime.getTime())) return now;
  if (clientTime.getTime() < now.getTime() - OFFLINE_MAX_AGE_MS)
    throw new DomainError("conflict", "The attempt time is outside the accepted range.");

  let accessFrom: Date | null = session?.startedAt ?? null;
  if (!accessFrom) {
    const downloads = await prisma.downloadedContentVersion.findMany({
      where: { userId, deviceId, lessonId: { in: exercise.lessons.map((l) => l.lessonId) } },
      select: { firstDownloadedAt: true },
      orderBy: { firstDownloadedAt: "asc" },
      take: 1,
    });
    accessFrom = downloads[0]?.firstDownloadedAt ?? null;
  }
  if (!accessFrom) return now;
  if (clientTime.getTime() < accessFrom.getTime() - OFFLINE_CLOCK_SKEW_MS)
    throw new DomainError("conflict", "The attempt time is before this device had the lesson.");
  return clientTime.getTime() > now.getTime() ? now : clientTime;
}

/** Resolves session, eligibility and time for an attempt, in that order. */
export async function resolveAttemptContext(
  prisma: PrismaClient,
  userId: string,
  exercise: ContextExercise,
  input: { sessionId?: string; lessonId?: string; occurredAt: string },
  options: { now: Date; deviceId?: string },
): Promise<AttemptContext> {
  const session = await resolveSession(prisma, userId, input.sessionId, input.lessonId, exercise);
  const clientOccurredAt = new Date(input.occurredAt);
  const occurredAt = await resolveAttemptTime(
    prisma,
    { userId, clientTime: clientOccurredAt, now: options.now, deviceId: options.deviceId },
    session,
    exercise,
  );
  // A valid lesson session can only exist for a reached lesson (startLessonSession refuses locked
  // ones, and lessons never re-lock once started); a valid review session only covers learned
  // characters. Everything else is decided from the lesson states.
  const countsForProgress = session ? true : await isProgressionEligible(prisma, userId, exercise);
  return {
    session,
    sessionType: session?.type ?? null,
    countsForProgress,
    occurredAt,
    clientOccurredAt,
  };
}
