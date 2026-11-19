/**
 * SYNTHETIC fixtures for learning-measurement tests (M15). Test databases only. Learners use the
 * reserved `.example` domain, so they count as learners (unlike `@hanziquest.test`), and a small
 * curriculum of CJK Extension A characters that no real content uses.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AttemptResult, PracticeMode, RoleKey, UserStatus } from "@/generated/prisma/enums";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import type { StrokeData } from "@/features/curriculum/stroke-data";

const strokes: StrokeData = {
  strokes: ["M 0 0"],
  medians: [
    [
      [0, 0],
      [1, 1],
    ],
  ],
};

export interface MeasurementFixture {
  curriculumId: string;
  lessonId: string;
  exerciseId: string;
  characterIds: string[];
}

/** A tiny curriculum with `count` characters (one word each, one lesson). */
export async function measurementCurriculum(
  prisma: PrismaClient,
  slug: string,
  count = 8,
  firstCodePoint = 0x4d00,
): Promise<MeasurementFixture> {
  const chars = Array.from({ length: count }, (_, i) => String.fromCodePoint(firstCodePoint + i));
  const v = validateCurriculumContent(
    {
      curriculum: {
        slug,
        name: `SYNTHETIC ${slug}`,
        framework: "CUSTOM",
        version: slug,
        source: "synthetic measurement fixture",
        sourceRefs: ["hanziquest-authored"],
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: Object.fromEntries(chars.map((c) => [c, { pinyin: "ā", meaning: `syn ${c}` }])),
      units: [
        {
          slug: "u",
          title: "U",
          lessons: [
            {
              slug: "l",
              title: "L",
              words: chars.map((c) => ({ simplified: c, pinyin: "ā", meaning: `syn ${c}` })),
            },
          ],
        },
      ],
    },
    () => strokes,
  );
  if (!v.ok || !v.content) throw new Error(JSON.stringify(v.issues.slice(0, 3)));
  const { curriculumId } = await importCurriculumContent(prisma, v.content, {
    publishNewLessons: true,
    lookupStrokes: () => strokes,
  });
  const lesson = await prisma.lesson.findFirstOrThrow({
    where: { unit: { level: { curriculumId } } },
    select: { id: true },
  });
  const characters = await prisma.character.findMany({
    where: { hanzi: { in: chars } },
    select: { id: true, hanzi: true },
  });
  const order = new Map(chars.map((c, i) => [c, i]));
  const exercise = await prisma.exercise.findFirstOrThrow({
    where: { curriculumId },
    select: { id: true },
  });
  return {
    curriculumId,
    lessonId: lesson.id,
    exerciseId: exercise.id,
    characterIds: characters
      .sort((a, b) => order.get(a.hanzi)! - order.get(b.hanzi)!)
      .map((c) => c.id),
  };
}

export async function syntheticLearner(
  prisma: PrismaClient,
  opts: {
    email: string;
    createdAt: Date;
    timezone?: string;
    status?: UserStatus;
    roles?: RoleKey[];
  },
) {
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      createdAt: opts.createdAt,
      status: opts.status ?? "ACTIVE",
      profile: {
        create: { displayName: "Synthetic", timezone: opts.timezone ?? "UTC" },
      },
    },
  });
  for (const key of opts.roles ?? ["LEARNER"]) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user.id;
}

export interface SyntheticAttempt {
  characterId: string;
  occurredAt: Date;
  mode?: PracticeMode;
  result: AttemptResult;
  techniqueOk?: boolean | null;
}

/** Inserts attempts (one character each) directly: test data only. */
export async function syntheticAttempts(
  prisma: PrismaClient,
  fixture: MeasurementFixture,
  userId: string,
  attempts: readonly SyntheticAttempt[],
) {
  const rows = attempts.map((a) => ({ id: randomUUID(), ...a }));
  await prisma.exerciseAttempt.createMany({
    data: rows.map((a) => ({
      id: a.id,
      clientEventId: a.id,
      userId,
      exerciseId: fixture.exerciseId,
      characterId: a.characterId,
      curriculumId: fixture.curriculumId,
      mode: a.mode ?? "INDEPENDENT",
      result: a.result,
      occurredAt: a.occurredAt,
    })),
  });
  await prisma.attemptCharacterResult.createMany({
    data: rows.map((a) => ({
      attemptId: a.id,
      position: 0,
      userId,
      characterId: a.characterId,
      mode: a.mode ?? "INDEPENDENT",
      result: a.result,
      techniqueOk: a.techniqueOk ?? null,
      occurredAt: a.occurredAt,
    })),
  });
}
