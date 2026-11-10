import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { Prisma as PrismaNS } from "@/generated/prisma/client";
import type { AttemptResult, LearningSessionType, PracticeMode } from "@/generated/prisma/enums";
import { DomainError } from "@/features/administration/services";
import { evaluateWord } from "@/features/handwriting/evaluate";
import { loadLevelReferences } from "@/features/handwriting/reference-store";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import type { WordEvaluation } from "@/features/handwriting/types";
import { techniqueVerdict } from "@/features/handwriting/technique";
import { evaluationConfigSchema } from "./evaluation-config";
import { attemptInputSchema } from "./attempt-schema";
import { applyAttemptProgress, lockLearner, type ProgressDelta } from "@/features/progress/record";

export interface AttemptOutcome {
  attemptId: string;
  duplicate: boolean;
  result: AttemptResult;
  score: number | null;
  mode: PracticeMode;
  evaluation: unknown;
  xpAwarded: number;
  /** Progress effects of this submission; null when it was a duplicate. */
  progress: ProgressDelta | null;
}

export interface SubmitOptions {
  now?: Date;
  /** Server-side device id when the attempt arrived through offline sync. */
  deviceId?: string;
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
    xpAwarded: number;
  },
  duplicate: boolean,
  progress: ProgressDelta | null = null,
): AttemptOutcome {
  return {
    attemptId: outcome.id,
    duplicate,
    result: outcome.result,
    score: outcome.score,
    mode: outcome.mode,
    evaluation: outcome.evaluation,
    xpAwarded: progress ? progress.xpAwarded : outcome.xpAwarded,
    progress,
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
  options: SubmitOptions = {},
): Promise<AttemptOutcome> {
  const now = options.now ?? new Date();
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

  let sessionType: LearningSessionType | null = null;
  if (input.sessionId) {
    const session = await prisma.learningSession.findUnique({ where: { id: input.sessionId } });
    if (!session || session.userId !== userId)
      throw new DomainError("not_found", "Session not found.");
    sessionType = session.type;
  }

  const config = evaluationConfigSchema.parse(exercise.evaluationConfig);
  const characterRows = await prisma.character.findMany({
    where: { hanzi: { in: config.characters } },
    select: { id: true, hanzi: true },
  });
  const characterIdOf = new Map(characterRows.map((c) => [c.hanzi, c.id]));
  let perCharacter: { result: AttemptResult; score: number | null; techniqueOk?: boolean | null }[];
  let result: AttemptResult;
  let score: number | null = null;
  let mode: PracticeMode;
  let evaluation: Prisma.InputJsonValue;
  let strokeData: Prisma.InputJsonValue | undefined;

  if (input.kind === "skip") {
    result = "SKIPPED";
    mode = exercise.type === "GUIDED_STROKE" ? "GUIDED" : "INDEPENDENT";
    evaluation = { kind: "skip" };
    perCharacter = config.characters.map(() => ({ result, score: null }));
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
    perCharacter = config.characters.map(() => ({ result, score: null }));
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
    perCharacter = word.characters.map((c) => ({
      result: c.band,
      score: c.score,
      // Technique only counts for independent recall; hinted attempts are guided.
      techniqueOk: mode === "INDEPENDENT" ? techniqueVerdict(c) : null,
    }));
  }

  const characters = config.characters.flatMap((hanzi, i) => {
    const characterId = characterIdOf.get(hanzi);
    return characterId ? [{ characterId, ...perCharacter[i]! }] : [];
  });

  try {
    return await prisma.$transaction(async (tx) => {
      await lockLearner(tx, userId);
      const created = await tx.exerciseAttempt.create({
        data: {
          clientEventId: input.clientEventId,
          userId,
          exerciseId: exercise.id,
          characterId: exercise.characterId,
          sessionId: input.sessionId ?? null,
          deviceId: options.deviceId ?? null,
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
      const progress = await applyAttemptProgress(
        tx,
        {
          id: created.id,
          userId,
          exerciseId: exercise.id,
          occurredAt,
          mode,
          result,
          sessionType,
          characters,
        },
        now,
      );
      return toStored(created, false, progress);
    });
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
