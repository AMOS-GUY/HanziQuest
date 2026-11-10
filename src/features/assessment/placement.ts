import type { PrismaClient } from "@/generated/prisma/client";
import { DomainError } from "@/features/administration/services";

/**
 * Placement check: two recognition questions per unit (character → meaning, 4 options plus
 * "I don't know"). Questions are generated deterministically from the assessment id, so the server
 * can regrade without storing the question plan or exposing answers to the client.
 *
 * Passing every question of a unit marks its lessons TESTED_OUT — but only for consecutive units
 * from the start, so the learning path never has gaps. Self-declared level is never used here.
 *
 * Guessing (M7, D-040): with 3 four-option questions per unit, guessing a unit succeeds with
 * probability 1/64 (it was 1/16 with 2). A completed check can't be retaken for
 * PLACEMENT_RETAKE_HOURS, so repeated guessing can't skip the path either. Testing out never
 * creates mastery or review history: it only opens lessons, which stay practicable.
 */
export const QUESTIONS_PER_UNIT = 3;
export const PLACEMENT_RETAKE_HOURS = 24;
export const OPTIONS_PER_QUESTION = 4;
const PLACEMENT_PASS_RATIO = 0.8;

export interface PlacementQuestion {
  unitId: string;
  characterId: string;
  hanzi: string;
  options: string[];
  correctIndex: number;
}

export interface PublicPlacementQuestion {
  hanzi: string;
  options: string[];
}

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface LevelUnitCharacters {
  unitId: string;
  characters: { id: string; hanzi: string; meaning: string }[];
}

/** Pure question generation (exported for tests). */
export function generateQuestions(
  seed: string,
  units: readonly LevelUnitCharacters[],
): PlacementQuestion[] {
  const rand = seededRandom(seed);
  const all = units.flatMap((u) => u.characters);
  const questions: PlacementQuestion[] = [];
  for (const unit of units) {
    for (const target of shuffle(unit.characters, rand).slice(0, QUESTIONS_PER_UNIT)) {
      const distractors = shuffle(
        all.filter((c) => c.id !== target.id && c.meaning !== target.meaning),
        rand,
      ).slice(0, OPTIONS_PER_QUESTION - 1);
      const options = shuffle([target, ...distractors], rand);
      questions.push({
        unitId: unit.unitId,
        characterId: target.id,
        hanzi: target.hanzi,
        options: options.map((o) => o.meaning),
        correctIndex: options.findIndex((o) => o.id === target.id),
      });
    }
  }
  return questions;
}

export async function loadLevelUnits(
  prisma: PrismaClient,
  levelId: string,
): Promise<LevelUnitCharacters[]> {
  const units = await prisma.unit.findMany({
    where: { levelId, lessons: { some: { status: "PUBLISHED" } } },
    orderBy: { position: "asc" },
    select: {
      id: true,
      lessons: {
        where: { status: "PUBLISHED" },
        orderBy: { position: "asc" },
        select: {
          characters: {
            where: { isNew: true },
            orderBy: { position: "asc" },
            select: { character: { select: { id: true, hanzi: true, meaning: true } } },
          },
        },
      },
    },
  });
  return units.map((u) => ({
    unitId: u.id,
    characters: u.lessons.flatMap((l) => l.characters.map((c) => c.character)),
  }));
}

/** The level placement targets: level 1 of the oldest published curriculum. */
export async function getPlacementLevel(prisma: PrismaClient) {
  return prisma.hSKLevel.findFirst({
    where: { level: 1, curriculum: { status: "PUBLISHED" } },
    orderBy: { curriculum: { createdAt: "asc" } },
    select: { id: true, curriculumId: true, name: true },
  });
}

/** When the learner may take the placement check again, or null if they may now. */
export async function placementRetakeAt(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const last = await prisma.placementAssessment.findFirst({
    where: { userId, status: "COMPLETED", completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });
  if (!last?.completedAt) return null;
  const at = new Date(last.completedAt.getTime() + PLACEMENT_RETAKE_HOURS * 3_600_000);
  return at > now ? at : null;
}

/** Returns the learner's open placement check (reused for an hour) or starts a new one. */
export async function startPlacement(prisma: PrismaClient, userId: string) {
  if (await placementRetakeAt(prisma, userId))
    throw new DomainError("conflict", "You can take the placement check again tomorrow.");
  const level = await getPlacementLevel(prisma);
  if (!level) throw new DomainError("not_found", "No published curriculum is available.");
  const recent = await prisma.placementAssessment.findFirst({
    where: {
      userId,
      status: "IN_PROGRESS",
      startedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    orderBy: { startedAt: "desc" },
  });
  const assessment =
    recent ??
    (await prisma.placementAssessment.create({
      data: { userId, curriculumId: level.curriculumId },
    }));
  const questions = generateQuestions(assessment.id, await loadLevelUnits(prisma, level.id));
  return {
    assessmentId: assessment.id,
    questions: questions.map<PublicPlacementQuestion>((q) => ({
      hanzi: q.hanzi,
      options: q.options,
    })),
  };
}

export interface PlacementSummary {
  correct: number;
  total: number;
  unitsTestedOut: number;
  lessonsTestedOut: number;
  estimatedLevel: number;
}

/** Grades answers (option index or null for "I don't know") and applies tested-out lessons. */
export async function submitPlacement(
  prisma: PrismaClient,
  userId: string,
  assessmentId: string,
  answers: readonly (number | null)[],
): Promise<PlacementSummary> {
  const assessment = await prisma.placementAssessment.findUnique({ where: { id: assessmentId } });
  if (!assessment || assessment.userId !== userId)
    throw new DomainError("not_found", "Placement check not found.");
  if (assessment.status !== "IN_PROGRESS")
    throw new DomainError("conflict", "This placement check is already finished.");
  const level = await getPlacementLevel(prisma);
  if (!level) throw new DomainError("not_found", "No published curriculum is available.");

  const units = await loadLevelUnits(prisma, level.id);
  const questions = generateQuestions(assessment.id, units);
  if (answers.length !== questions.length)
    throw new DomainError("conflict", "Answer every question.");

  const graded = questions.map((q, i) => ({ q, correct: answers[i] === q.correctIndex }));
  const correct = graded.filter((g) => g.correct).length;

  // Consecutive units (from the first) where every question was answered correctly.
  const passedUnits: string[] = [];
  for (const unit of units) {
    const unitQuestions = graded.filter((g) => g.q.unitId === unit.unitId);
    if (unitQuestions.length === 0 || !unitQuestions.every((g) => g.correct)) break;
    passedUnits.push(unit.unitId);
  }

  const estimatedLevel = correct / Math.max(questions.length, 1) >= PLACEMENT_PASS_RATIO ? 1 : 0;
  let lessonsTestedOut = 0;
  await prisma.$transaction(async (tx) => {
    await tx.assessmentResult.createMany({
      data: graded.map((g) => ({ assessmentId, characterId: g.q.characterId, correct: g.correct })),
    });
    await tx.placementAssessment.update({
      where: { id: assessmentId },
      data: { status: "COMPLETED", completedAt: new Date(), estimatedLevel },
    });
    const lessons = await tx.lesson.findMany({
      where: { unitId: { in: passedUnits }, status: "PUBLISHED" },
      select: { id: true },
    });
    const existing = new Set(
      (
        await tx.lessonProgress.findMany({
          where: { userId, lessonId: { in: lessons.map((l) => l.id) } },
        })
      ).map((p) => p.lessonId),
    );
    const fresh = lessons.filter((l) => !existing.has(l.id));
    if (fresh.length > 0) {
      await tx.lessonProgress.createMany({
        data: fresh.map((l) => ({ userId, lessonId: l.id, status: "TESTED_OUT" as const })),
      });
    }
    lessonsTestedOut = fresh.length;
  });

  return {
    correct,
    total: questions.length,
    unitsTestedOut: passedUnits.length,
    lessonsTestedOut,
    estimatedLevel,
  };
}
