import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { submitAttempt } from "@/features/exercises/attempts";
import { completeLessonSession, startLessonSession } from "@/features/learning/sessions";
import { getLessonStatesForLevel } from "@/features/progression/lesson-states";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;

let userId: string;
let levelId: string;
let lesson1: string;
let lesson2: string;

function ink(hanzi: string, seed = 1) {
  return toInk(fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians).medians, { seed });
}

async function newUser() {
  const r = await registerUser(prisma, {
    displayName: "L",
    email: uniqueEmail("learn"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

async function exercisesOf(lessonId: string) {
  return prisma.lessonExercise.findMany({
    where: { lessonId },
    orderBy: { position: "asc" },
    include: { exercise: { include: { character: true } } },
  });
}

beforeAll(async () => {
  await ensureRoles(prisma);
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `learning-${RUN}`,
        name: "Learning IT",
        framework: "CUSTOM",
        version: `learning-${RUN}`,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: {
        你: { pinyin: "nǐ", meaning: "you" },
        好: { pinyin: "hǎo", meaning: "good" },
        我: { pinyin: "wǒ", meaning: "I" },
        他: { pinyin: "tā", meaning: "he" },
      },
      units: [
        {
          slug: "u1",
          title: "U1",
          lessons: [
            {
              slug: "l1",
              title: "L1",
              words: [{ simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello" }],
            },
            {
              slug: "l2",
              title: "L2",
              words: [
                { simplified: "我", pinyin: "wǒ", meaning: "I" },
                { simplified: "他", pinyin: "tā", meaning: "he" },
              ],
            },
          ],
        },
      ],
    },
    loadStrokeData,
  );
  expect(content.ok).toBe(true);
  const summary = await importCurriculumContent(prisma, content.content!, {
    publishNewLessons: true,
    lookupStrokes: loadStrokeData,
  });
  const level = await prisma.hSKLevel.findFirstOrThrow({
    where: { curriculumId: summary.curriculumId },
  });
  levelId = level.id;
  const lessons = await prisma.lesson.findMany({
    where: { unit: { levelId } },
    orderBy: { position: "asc" },
  });
  lesson1 = lessons[0]!.id;
  lesson2 = lessons[1]!.id;
  userId = await newUser();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("lesson states", () => {
  it("starts with only the first lesson available", async () => {
    const { states } = await getLessonStatesForLevel(prisma, userId, levelId);
    expect(states.get(lesson1)).toBe("AVAILABLE");
    expect(states.get(lesson2)).toBe("LOCKED");
  });

  it("refuses to start a locked lesson", async () => {
    await expect(startLessonSession(prisma, userId, lesson2)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("attempts", () => {
  it("re-evaluates handwriting on the server and stores an independent attempt", async () => {
    const freehand = (await exercisesOf(lesson1)).find(
      (e) => e.exercise.key === "char:你:freehand",
    )!.exercise;
    const eventId = randomUUID();
    const outcome = await submitAttempt(prisma, userId, {
      clientEventId: eventId,
      exerciseId: freehand.id,
      occurredAt: new Date().toISOString(),
      kind: "writing",
      drawings: [ink("你")],
    });
    expect(outcome.duplicate).toBe(false);
    expect(["EXCELLENT", "GOOD"]).toContain(outcome.result);
    expect(outcome.mode).toBe("INDEPENDENT");
    const stored = await prisma.exerciseAttempt.findUniqueOrThrow({
      where: { clientEventId: eventId },
    });
    expect(stored.characterId).toBe(freehand.characterId);
    expect(stored.score).toBeGreaterThan(70);
    expect((stored.evaluation as { engineVersion: string }).engineVersion).toBe("hq-eval-1");
  });

  it("ignores any client-supplied score and fails a wrong character", async () => {
    const freehand = (await exercisesOf(lesson1)).find(
      (e) => e.exercise.key === "char:你:freehand",
    )!.exercise;
    const outcome = await submitAttempt(prisma, userId, {
      clientEventId: randomUUID(),
      exerciseId: freehand.id,
      occurredAt: new Date().toISOString(),
      kind: "writing",
      drawings: [ink("他")],
      score: 100,
      result: "EXCELLENT",
    });
    expect(outcome.result).toBe("TRY_AGAIN");
  });

  it("is idempotent on clientEventId and rejects reuse by another user", async () => {
    const ex = (await exercisesOf(lesson1)).find(
      (e) => e.exercise.type === "PINYIN_TO_HANZI",
    )!.exercise;
    const body = {
      clientEventId: randomUUID(),
      exerciseId: ex.id,
      occurredAt: new Date().toISOString(),
      kind: "writing" as const,
      drawings: [ink("你", 2), ink("好", 3)],
    };
    const first = await submitAttempt(prisma, userId, body);
    const second = await submitAttempt(prisma, userId, body);
    expect(second.duplicate).toBe(true);
    expect(second.attemptId).toBe(first.attemptId);
    expect(
      await prisma.exerciseAttempt.count({ where: { clientEventId: body.clientEventId } }),
    ).toBe(1);

    const other = await newUser();
    await expect(submitAttempt(prisma, other, body)).rejects.toMatchObject({ code: "conflict" });
  });

  it("marks hinted attempts as guided, not independent recall", async () => {
    const ex = (await exercisesOf(lesson1)).find(
      (e) => e.exercise.key === "char:好:freehand",
    )!.exercise;
    const outcome = await submitAttempt(prisma, userId, {
      clientEventId: randomUUID(),
      exerciseId: ex.id,
      occurredAt: new Date().toISOString(),
      hintsUsed: 1,
      kind: "writing",
      drawings: [ink("好")],
    });
    expect(outcome.mode).toBe("GUIDED");
  });

  it("validates kind, drawing count and time", async () => {
    const list = await exercisesOf(lesson1);
    const word = list.find((e) => e.exercise.type === "PINYIN_TO_HANZI")!.exercise;
    const guided = list.find((e) => e.exercise.type === "GUIDED_STROKE")!.exercise;
    const base = { occurredAt: new Date().toISOString() };
    await expect(
      submitAttempt(prisma, userId, {
        ...base,
        clientEventId: randomUUID(),
        exerciseId: word.id,
        kind: "writing",
        drawings: [ink("你")],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      submitAttempt(prisma, userId, {
        ...base,
        clientEventId: randomUUID(),
        exerciseId: guided.id,
        kind: "writing",
        drawings: [ink("你")],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      submitAttempt(prisma, userId, {
        clientEventId: randomUUID(),
        exerciseId: word.id,
        occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        kind: "skip",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      submitAttempt(prisma, userId, {
        ...base,
        clientEventId: "not-a-uuid",
        exerciseId: word.id,
        kind: "skip",
      }),
    ).rejects.toThrow();
  });

  it("refuses exercises whose lessons are unpublished", async () => {
    await prisma.lesson.update({ where: { id: lesson2 }, data: { status: "DRAFT" } });
    try {
      const ex = (await exercisesOf(lesson2))[0]!.exercise;
      await expect(
        submitAttempt(prisma, userId, {
          clientEventId: randomUUID(),
          exerciseId: ex.id,
          occurredAt: new Date().toISOString(),
          kind: "skip",
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await prisma.lesson.update({ where: { id: lesson2 }, data: { status: "PUBLISHED" } });
    }
  });
});

describe("lesson sessions", () => {
  it("requires every exercise and enough real attempts, then completes and unlocks the next lesson", async () => {
    const learner = await newUser();
    const session = await startLessonSession(prisma, learner, lesson1);
    expect(
      (
        await prisma.lessonProgress.findUniqueOrThrow({
          where: { userId_lessonId: { userId: learner, lessonId: lesson1 } },
        })
      ).status,
    ).toBe("IN_PROGRESS");
    await expect(completeLessonSession(prisma, learner, session.id)).rejects.toMatchObject({
      code: "conflict",
    });

    const list = await exercisesOf(lesson1);
    // Skip everything first: completion must be refused.
    for (const { exercise } of list) {
      await submitAttempt(prisma, learner, {
        clientEventId: randomUUID(),
        exerciseId: exercise.id,
        sessionId: session.id,
        occurredAt: new Date().toISOString(),
        kind: "skip",
      });
    }
    await expect(completeLessonSession(prisma, learner, session.id)).rejects.toMatchObject({
      code: "conflict",
    });

    // Now genuinely attempt every exercise.
    for (const { exercise } of list) {
      const chars = (exercise.evaluationConfig as { characters: string[] }).characters;
      await submitAttempt(prisma, learner, {
        clientEventId: randomUUID(),
        exerciseId: exercise.id,
        sessionId: session.id,
        occurredAt: new Date().toISOString(),
        ...(exercise.type === "GUIDED_STROKE"
          ? { kind: "guided", mistakes: 0 }
          : { kind: "writing", drawings: chars.map((c, i) => ink(c, i + 5)) }),
      });
    }
    const result = await completeLessonSession(prisma, learner, session.id);
    expect(result.nextLessonId).toBe(lesson2);
    const { states } = await getLessonStatesForLevel(prisma, learner, levelId);
    expect(states.get(lesson1)).toBe("COMPLETED");
    expect(states.get(lesson2)).toBe("AVAILABLE");

    // Idempotent.
    await expect(completeLessonSession(prisma, learner, session.id)).resolves.toMatchObject({
      lessonId: lesson1,
    });
  });

  it("does not let one learner complete another learner's session", async () => {
    const owner = await newUser();
    const session = await startLessonSession(prisma, owner, lesson1);
    await expect(completeLessonSession(prisma, userId, session.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
