import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { Prisma as PrismaNS } from "@/generated/prisma/client";
import type { AttemptResult, PracticeMode } from "@/generated/prisma/enums";
import { DomainError } from "@/features/administration/services";
import { evaluateWord } from "@/features/handwriting/evaluate";
import { loadLevelReferences } from "@/features/handwriting/reference-store";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import type { WordEvaluation } from "@/features/handwriting/types";
import { evaluationConfigSchema } from "./evaluation-config";
import { attemptInputSchema } from "./attempt-schema";

export interface AttemptOutcome {
  attemptId: string;
  duplicate: boolean;
  result: AttemptResult;
  score: number | null;
  mode: PracticeMode;
  evaluation: unknown;
}

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function guidedResult(mistakes: number, strokeCount: number): AttemptResult {
  if (mistakes === 0) return "EXCELLENT";
  if (mistakes <= Math.max(1, Math.floor(strokeCount / 3))) return "GOOD";
  if (mistakes <= strokeCount) return "NEEDS_IMPROVEMENT";
  return "TRY_AGAIN";
}

function toStored(
  outcome: {
    id: string;
    result: AttemptResult;
    score: number | null;
    mode: PracticeMode;
    evaluation: Prisma.JsonValue;
  },
  duplicate: boolean,
): AttemptOutcome {
  return {
    attemptId: outcome.id,
    duplicate,
    result: outcome.result,
    score: outcome.score,
    mode: outcome.mode,
    evaluation: outcome.evaluation,
  };
}

/**
 * Records an exercise attempt. The server re-evaluates handwriting itself — client-side scores
 * are never trusted. Idempotent on `clientEventId`: resubmitting returns the stored attempt.
 */
export async function submitAttempt(
  prisma: PrismaClient,
  userId: string,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<AttemptOutcome> {
  const input = attemptInputSchema.parse(rawInput);

  const existing = await prisma.exerciseAttempt.findUnique({
    where: { clientEventId: input.clientEventId },
  });
  if (existing) {
    if (existing.userId !== userId)
      throw new DomainError("conflict", "This attempt id is already in use.");
    return toStored(existing, true);
  }

  const occurredAt = new Date(input.occurredAt);
  if (
    occurredAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS ||
    occurredAt.getTime() < now.getTime() - MAX_AGE_MS
  ) {
    throw new DomainError("conflict", "The attempt time is outside the accepted range.");
  }

  const exercise = await prisma.exercise.findUnique({
    where: { id: input.exerciseId },
    include: {
      lessons: {
        where: { lesson: { status: "PUBLISHED" } },
        select: { lesson: { select: { unit: { select: { levelId: true } } } } },
      },
      character: { select: { strokeCount: true } },
    },
  });
  if (!exercise || exercise.status !== "PUBLISHED" || exercise.lessons.length === 0) {
    throw new DomainError("not_found", "Exercise not found.");
  }

  if (input.sessionId) {
    const session = await prisma.learningSession.findUnique({ where: { id: input.sessionId } });
    if (!session || session.userId !== userId)
      throw new DomainError("not_found", "Session not found.");
  }

  const config = evaluationConfigSchema.parse(exercise.evaluationConfig);
  let result: AttemptResult;
  let score: number | null = null;
  let mode: PracticeMode;
  let evaluation: Prisma.InputJsonValue;
  let strokeData: Prisma.InputJsonValue | undefined;

  if (input.kind === "skip") {
    result = "SKIPPED";
    mode = exercise.type === "GUIDED_STROKE" ? "GUIDED" : "INDEPENDENT";
    evaluation = { kind: "skip" };
  } else if (exercise.type === "GUIDED_STROKE") {
    if (input.kind !== "guided")
      throw new DomainError("conflict", "This exercise expects guided practice.");
    const strokes = exercise.character?.strokeCount ?? 1;
    result = guidedResult(input.mistakes, strokes);
    mode = "GUIDED";
    evaluation = {
      kind: "guided",
      engine: "hanzi-writer-quiz",
      mistakes: input.mistakes,
      trust: "client-reported",
    };
  } else {
    if (input.kind !== "writing")
      throw new DomainError("conflict", "This exercise expects handwriting.");
    if (input.drawings.length !== config.characters.length) {
      throw new DomainError("conflict", `Expected ${config.characters.length} drawing(s).`);
    }
    const levelId = exercise.lessons[0]!.lesson.unit.levelId;
    const candidates = await loadLevelReferences(prisma, levelId);
    const expected = await Promise.all(
      config.characters.map(async (hanzi) => {
        const found = candidates.find((c) => c.hanzi === hanzi);
        if (found) return found;
        const row = await prisma.character.findUnique({
          where: { hanzi },
          select: { strokes: { orderBy: { strokeIndex: "asc" }, select: { median: true } } },
        });
        if (!row || row.strokes.length === 0)
          throw new DomainError("not_found", `No reference data for ${hanzi}.`);
        return fromMakeMeAHanzi(
          hanzi,
          row.strokes.map((s) => s.median as number[][]),
        );
      }),
    );
    const word: WordEvaluation = evaluateWord(input.drawings, expected, {
      weights: config.weights,
      candidates,
    });
    result = word.band;
    score = word.score;
    // Hints show the character, so the attempt no longer counts as independent recall.
    mode = input.hintsUsed > 0 ? "GUIDED" : "INDEPENDENT";
    evaluation = word as unknown as Prisma.InputJsonValue;
    strokeData = input.drawings as unknown as Prisma.InputJsonValue;
  }

  try {
    const created = await prisma.exerciseAttempt.create({
      data: {
        clientEventId: input.clientEventId,
        userId,
        exerciseId: exercise.id,
        characterId: exercise.characterId,
        sessionId: input.sessionId ?? null,
        curriculumId: exercise.curriculumId,
        mode,
        result,
        score,
        strokeData,
        evaluation,
        hintsUsed: input.hintsUsed,
        durationMs: input.durationMs ?? null,
        occurredAt,
      },
    });
    return toStored(created, false);
  } catch (error) {
    // Concurrent duplicate submission: return the attempt that won the race.
    if (error instanceof PrismaNS.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.exerciseAttempt.findUnique({
        where: { clientEventId: input.clientEventId },
      });
      if (winner && winner.userId === userId) return toStored(winner, true);
    }
    throw error;
  }
}
