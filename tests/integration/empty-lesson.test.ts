/**
 * A published lesson with no published exercises can't be completed, and can't be published.
 *
 * Regression for the empty-lesson exploit found on 2026-11-21: two authenticated requests
 * (start a session, complete it) used to mark such a lesson COMPLETED with no attempts, grant
 * 50 XP (lesson 20, first-lesson achievement 20, daily goal 10) and unlock the next lesson.
 * XP amounts and reward rules are unchanged by the fix; only empty completion is refused.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import * as admin from "@/features/administration/curriculum-admin";
import { setCurriculumStatus, setLessonStatus } from "@/features/administration/services";
import type { Actor } from "@/features/administration/services";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { submitAttempt } from "@/features/exercises/attempts";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import { completeLessonSession, startLessonSession } from "@/features/learning/sessions";
import { processSyncBatch } from "@/features/offline/sync-service";
import { getLessonStatesForLevel } from "@/features/progression/lesson-states";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const meta = { source: "integration test", licenseStatus: "ORIGINAL", verification: "PROVISIONAL" };
let editor: Actor;

beforeAll(async () => {
  await ensureRoles(prisma);
  const r = await registerUser(prisma, {
    displayName: "Editor",
    email: uniqueEmail("empty-editor"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  editor = { id: r.userId, roles: ["CURRICULUM_EDITOR"], ip: "127.0.0.1", userAgent: "vitest" };
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function newLearner() {
  const r = await registerUser(prisma, {
    displayName: "Learner",
    email: uniqueEmail("empty-learner"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

/** A published curriculum with two published lessons, imported like real content. */
async function publishedLevel() {
  const tag = randomUUID().slice(0, 8);
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `empty-${tag}`,
        name: "Empty lesson IT",
        framework: "CUSTOM",
        version: `empty-${tag}`,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: {
        你: { pinyin: "nǐ", meaning: "you" },
        好: { pinyin: "hǎo", meaning: "good" },
        我: { pinyin: "wǒ", meaning: "I" },
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
            { slug: "l2", title: "L2", words: [{ simplified: "我", pinyin: "wǒ", meaning: "I" }] },
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
  const lessons = await prisma.lesson.findMany({
    where: { unit: { levelId: level.id } },
    orderBy: { position: "asc" },
  });
  return {
    curriculumId: summary.curriculumId,
    levelId: level.id,
    first: lessons[0]!.id,
    next: lessons[1]!.id,
  };
}

async function exercisesOf(lessonId: string) {
  return prisma.lessonExercise.findMany({
    where: { lessonId },
    orderBy: { position: "asc" },
    include: { exercise: true },
  });
}

/** Unpublish every exercise of a published lesson through the editor's normal path. */
async function emptyThroughEditing(lessonId: string) {
  const list = await exercisesOf(lessonId);
  expect(list.length).toBeGreaterThan(1);
  for (const [i, { exercise }] of list.entries()) {
    await admin.updateExercise(prisma, editor, exercise.id, {
      promptText: promptTextOf(exercise.type, exercise.prompt),
      difficulty: String(exercise.difficulty),
      // Both non-published states: DRAFT (unpublished) and ARCHIVED (withdrawn).
      status: i % 2 === 0 ? "DRAFT" : "ARCHIVED",
    });
  }
  expect(
    await prisma.lessonExercise.count({ where: { lessonId, exercise: { status: "PUBLISHED" } } }),
  ).toBe(0);
  expect((await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } })).status).toBe(
    "PUBLISHED",
  );
}

/** The prompt text an editor would resubmit unchanged (updateExercise's field per type). */
function promptTextOf(type: string, prompt: unknown): string {
  const p = (prompt ?? {}) as Record<string, unknown>;
  const value = type === "PINYIN_TO_HANZI" ? p.pinyin : p.meaning;
  if (typeof value !== "string") throw new Error(`no prompt text for ${type}`);
  return value;
}

/** Everything an empty completion must not have granted. */
async function expectNothingGranted(
  userId: string,
  lessonId: string,
  levelId: string,
  nextId: string,
) {
  expect(await prisma.xPTransaction.count({ where: { userId } })).toBe(0);
  expect(await prisma.userAchievement.count({ where: { userId } })).toBe(0);
  const progress = await prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId } },
  });
  expect(progress?.status).not.toBe("COMPLETED");
  expect(progress?.completedAt ?? null).toBeNull();
  const { states } = await getLessonStatesForLevel(prisma, userId, levelId);
  expect(states.get(lessonId)).not.toBe("COMPLETED");
  expect(states.get(nextId)).toBe("LOCKED");
  expect(
    await prisma.learningSession.count({ where: { userId, completedAt: { not: null } } }),
  ).toBe(0);
}

describe("completing a lesson with no published exercises", () => {
  it("is refused after every exercise was unpublished or archived (the original exploit)", async () => {
    const { levelId, first, next } = await publishedLevel();
    await emptyThroughEditing(first);
    const learner = await newLearner();

    const session = await startLessonSession(prisma, learner, first);
    await expect(completeLessonSession(prisma, learner, session.id)).rejects.toMatchObject({
      code: "conflict",
      message: "This lesson has no exercises yet.",
    });
    await expectNothingGranted(learner, first, levelId, next);
  });

  it("is refused for a lesson with no exercise rows at all (published before the guard)", async () => {
    const tag = randomUUID().slice(0, 8);
    const curriculum = await admin.createCurriculum(prisma, editor, {
      slug: `bare-${tag}`,
      name: "Bare",
      framework: "CUSTOM",
      version: `bare-${tag}`,
      ...meta,
    });
    const level = await admin.createLevel(prisma, editor, {
      curriculumId: curriculum.id,
      level: "1",
      name: "L1",
    });
    const unit = await admin.createUnit(prisma, editor, {
      levelId: level.id,
      slug: "u1",
      title: "U1",
    });
    const bare = await admin.createLesson(prisma, editor, {
      unitId: unit.id,
      slug: "l1",
      title: "Bare",
    });
    const after = await admin.createLesson(prisma, editor, {
      unitId: unit.id,
      slug: "l2",
      title: "After",
    });
    // Legacy rows: the publication guard now refuses this, so write them as old data would be.
    await prisma.lesson.updateMany({
      where: { id: { in: [bare.id, after.id] } },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    await setCurriculumStatus(prisma, editor, curriculum.id, "PUBLISHED");
    expect(await prisma.lessonExercise.count({ where: { lessonId: bare.id } })).toBe(0);

    const learner = await newLearner();
    const session = await startLessonSession(prisma, learner, bare.id);
    await expect(completeLessonSession(prisma, learner, session.id)).rejects.toMatchObject({
      code: "conflict",
    });
    await expectNothingGranted(learner, bare.id, level.id, after.id);
  });

  it("is refused through offline sync too, as a rejected (not retried) event", async () => {
    const { levelId, first, next } = await publishedLevel();
    await emptyThroughEditing(first);
    const learner = await newLearner();
    const eventId = randomUUID();

    const { results } = await processSyncBatch(prisma, learner, {
      deviceId: randomUUID(),
      events: [
        {
          id: eventId,
          type: "lesson.complete",
          clientCreatedAt: new Date().toISOString(),
          payload: { lessonId: first, attemptIds: [] },
        },
      ],
    });
    expect(results).toEqual([
      { id: eventId, status: "rejected", error: "This lesson has no exercises yet." },
    ]);
    expect((await prisma.syncEvent.findUniqueOrThrow({ where: { id: eventId } })).status).toBe(
      "REJECTED",
    );
    await expectNothingGranted(learner, first, levelId, next);
  });

  it("keeps a session that was already completed idempotent, granting nothing more", async () => {
    const { first } = await publishedLevel();
    await emptyThroughEditing(first);
    const learner = await newLearner();
    const session = await startLessonSession(prisma, learner, first);
    // As left by the exploit before the fix.
    const at = new Date();
    await prisma.learningSession.update({
      where: { id: session.id },
      data: { completedAt: at, endedAt: at },
    });
    await prisma.lessonProgress.update({
      where: { userId_lessonId: { userId: learner, lessonId: first } },
      data: { status: "COMPLETED", completedAt: at },
    });

    const again = await completeLessonSession(prisma, learner, session.id);
    expect(again.progress).toBeNull();
    expect(await prisma.xPTransaction.count({ where: { userId: learner } })).toBe(0);
  });
});

describe("legitimate completion is unchanged", () => {
  it("completes after real attempts, grants the usual rewards once, and unlocks the next lesson", async () => {
    const { levelId, first, next } = await publishedLevel();
    const learner = await newLearner();
    const session = await startLessonSession(prisma, learner, first);
    for (const { exercise } of await exercisesOf(first)) {
      const chars = (exercise.evaluationConfig as { characters: string[] }).characters;
      await submitAttempt(prisma, learner, {
        clientEventId: randomUUID(),
        exerciseId: exercise.id,
        sessionId: session.id,
        occurredAt: new Date().toISOString(),
        ...(exercise.type === "GUIDED_STROKE"
          ? { kind: "guided", mistakes: 0 }
          : {
              kind: "writing",
              drawings: chars.map((c, i) =>
                toInk(fromMakeMeAHanzi(c, loadStrokeData(c)!.medians).medians, { seed: i + 3 }),
              ),
            }),
      });
    }
    const done = await completeLessonSession(prisma, learner, session.id);
    expect(done.nextLessonId).toBe(next);
    expect(done.progress?.xpAwarded).toBe(20);
    expect(
      await prisma.xPTransaction.count({ where: { userId: learner, reason: "LESSON_COMPLETED" } }),
    ).toBe(1);
    const { states } = await getLessonStatesForLevel(prisma, learner, levelId);
    expect(states.get(first)).toBe("COMPLETED");
    expect(states.get(next)).toBe("AVAILABLE");

    const xpBefore = await prisma.xPTransaction.count({ where: { userId: learner } });
    const again = await completeLessonSession(prisma, learner, session.id);
    expect(again.progress).toBeNull();
    expect(await prisma.xPTransaction.count({ where: { userId: learner } })).toBe(xpBefore);
  });
});

describe("publishing a lesson", () => {
  it("is refused without a published exercise, and writes nothing", async () => {
    const { first } = await publishedLevel();
    await setLessonStatus(prisma, editor, first, "DRAFT");
    for (const { exercise } of await exercisesOf(first))
      await prisma.exercise.update({ where: { id: exercise.id }, data: { status: "DRAFT" } });
    const audits = await prisma.auditLog.count({ where: { entityId: first } });
    const revisions = await prisma.contentRevision.count({ where: { entityId: first } });

    await expect(setLessonStatus(prisma, editor, first, "PUBLISHED")).rejects.toMatchObject({
      code: "conflict",
      message: "Add at least one published exercise before publishing the lesson.",
    });
    expect((await prisma.lesson.findUniqueOrThrow({ where: { id: first } })).status).toBe("DRAFT");
    expect(await prisma.auditLog.count({ where: { entityId: first } })).toBe(audits);
    expect(await prisma.contentRevision.count({ where: { entityId: first } })).toBe(revisions);

    // One published exercise is enough.
    const one = (await exercisesOf(first))[0]!.exercise;
    await prisma.exercise.update({ where: { id: one.id }, data: { status: "PUBLISHED" } });
    await expect(setLessonStatus(prisma, editor, first, "PUBLISHED")).resolves.toMatchObject({
      status: "PUBLISHED",
    });
  });

  it("is refused for a new lesson with no exercises; unpublishing stays allowed", async () => {
    const { levelId, next } = await publishedLevel();
    const unit = await prisma.unit.findFirstOrThrow({ where: { levelId } });
    const blank = await admin.createLesson(prisma, editor, {
      unitId: unit.id,
      slug: `blank-${randomUUID().slice(0, 6)}`,
      title: "Blank",
    });
    await expect(setLessonStatus(prisma, editor, blank.id, "PUBLISHED")).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(setLessonStatus(prisma, editor, next, "DRAFT")).resolves.toMatchObject({
      status: "DRAFT",
    });
  });
});
