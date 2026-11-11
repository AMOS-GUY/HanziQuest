/**
 * M6 regression tests: failure conditions and isolation guarantees found during the quality
 * audit (docs/M6_QUALITY_AUDIT.md). Each test names the defect or risk it guards.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { submitAttempt } from "@/features/exercises/attempts";
import {
  completeLessonSession,
  getDueReviews,
  startLessonSession,
} from "@/features/learning/sessions";
import { processSyncBatch } from "@/features/offline/sync-service";
import { setCurriculumStatus as publishCurriculum } from "@/features/administration/services";
import { getLessonState, getLessonStatesForLevel } from "@/features/progression/lesson-states";
import { getProgressDetails, getProgressSummary } from "@/features/progress/queries";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;

let curriculumId: string;
let levelId: string;
let lesson1: string;

function ink(hanzi: string, seed = 1) {
  return toInk(fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians).medians, { seed });
}

async function newUser() {
  const r = await registerUser(prisma, {
    displayName: "Q",
    email: uniqueEmail("quality"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  await prisma.profile.update({
    where: { userId: r.userId },
    data: { timezone: "UTC", dailyGoalXp: 20, onboardingCompletedAt: new Date() },
  });
  return r.userId;
}

async function freehand(lessonId: string) {
  const row = await prisma.lessonExercise.findFirstOrThrow({
    where: { lessonId, exercise: { type: "FREEHAND_WRITING", characterId: { not: null } } },
    include: { exercise: true },
  });
  return {
    id: row.exercise.id,
    hanzi: (row.exercise.evaluationConfig as { characters: string[] }).characters[0]!,
  };
}

function writing(exerciseId: string, hanzi: string, extra: Record<string, unknown> = {}) {
  return {
    clientEventId: randomUUID(),
    exerciseId,
    occurredAt: new Date().toISOString(),
    kind: "writing" as const,
    drawings: [ink(hanzi, 5)],
    ...extra,
  };
}

async function setCurriculumStatus(status: "PUBLISHED" | "ARCHIVED" | "DRAFT") {
  await prisma.curriculum.update({ where: { id: curriculumId }, data: { status } });
}

beforeAll(async () => {
  await ensureRoles(prisma);
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `quality-${RUN}`,
        name: "Quality IT",
        framework: "CUSTOM",
        version: `quality-${RUN}`,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: {
        人: { pinyin: "rén", meaning: "person" },
        大: { pinyin: "dà", meaning: "big" },
      },
      units: [
        {
          slug: "u1",
          title: "U1",
          lessons: [
            {
              slug: "l1",
              title: "L1",
              words: [{ simplified: "人", pinyin: "rén", meaning: "person" }],
            },
            {
              slug: "l2",
              title: "L2",
              words: [{ simplified: "大", pinyin: "dà", meaning: "big" }],
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
  curriculumId = summary.curriculumId;
  await setCurriculumStatus("PUBLISHED");
  const lessons = await prisma.lesson.findMany({
    where: { unit: { level: { curriculumId } } },
    orderBy: { position: "asc" },
    include: { unit: true },
  });
  lesson1 = lessons[0]!.id;
  levelId = lessons[0]!.unit.levelId;
});

afterAll(async () => {
  await setCurriculumStatus("PUBLISHED").catch(() => undefined);
  await prisma.$disconnect();
});

describe("D-M6-01: lessons of an unpublished curriculum are hidden from learners", () => {
  it("refuses lesson state, sessions, attempts and reviews once the curriculum is archived", async () => {
    const user = await newUser();
    const ex = await freehand(lesson1);
    // While published, the learner practises and the character becomes due later.
    const session = await startLessonSession(prisma, user, lesson1);
    await submitAttempt(prisma, user, writing(ex.id, ex.hanzi, { sessionId: session.id }));
    expect(await getLessonState(prisma, user, lesson1)).toBe("IN_PROGRESS");

    await setCurriculumStatus("ARCHIVED");
    try {
      expect(await getLessonState(prisma, user, lesson1)).toBeNull();
      expect((await getLessonStatesForLevel(prisma, user, levelId)).lessons).toHaveLength(0);
      await expect(startLessonSession(prisma, user, lesson1)).rejects.toMatchObject({
        code: "not_found",
      });
      await expect(submitAttempt(prisma, user, writing(ex.id, ex.hanzi))).rejects.toMatchObject({
        code: "not_found",
      });
      const far = new Date(Date.now() + 365 * 86_400_000);
      // Characters are shared between curricula, so 人 may still be due through another
      // published curriculum, but never through an exercise of the archived one.
      const due = await getDueReviews(prisma, user, far);
      const dueExercises = await prisma.exercise.findMany({
        where: { id: { in: due.map((d) => d.exerciseId) } },
        select: { curriculumId: true },
      });
      expect(dueExercises.filter((e) => e.curriculumId === curriculumId)).toHaveLength(0);
    } finally {
      await setCurriculumStatus("PUBLISHED");
    }
    // Republishing restores access, and history was kept.
    expect(await getLessonState(prisma, user, lesson1)).toBe("IN_PROGRESS");
    expect(await prisma.exerciseAttempt.count({ where: { userId: user } })).toBe(1);
  });

  it("treats a draft curriculum like an archived one", async () => {
    const user = await newUser();
    await setCurriculumStatus("DRAFT");
    try {
      expect(await getLessonState(prisma, user, lesson1)).toBeNull();
    } finally {
      await setCurriculumStatus("PUBLISHED");
    }
    expect(await getLessonState(prisma, user, lesson1)).toBe("AVAILABLE");
  });
});

describe("D-M6-05: curricula can be published and withdrawn from the admin", () => {
  it("refuses to publish a curriculum without a published lesson, and audits changes", async () => {
    const editor = await newUser();
    const actor = { id: editor, roles: ["CURRICULUM_EDITOR" as const] };
    const empty = await prisma.curriculum.create({
      data: {
        slug: `empty-${RUN}`,
        name: "Empty",
        framework: "CUSTOM",
        version: `empty-${RUN}`,
        source: "integration test",
      },
    });
    await expect(publishCurriculum(prisma, actor, empty.id, "PUBLISHED")).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await prisma.curriculum.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe(
      "DRAFT",
    );

    const learner = await newUser();
    await publishCurriculum(prisma, actor, curriculumId, "ARCHIVED");
    try {
      expect(await getLessonState(prisma, learner, lesson1)).toBeNull();
    } finally {
      await publishCurriculum(prisma, actor, curriculumId, "PUBLISHED");
    }
    expect(await getLessonState(prisma, learner, lesson1)).toBe("AVAILABLE");
    const actions = await prisma.auditLog.findMany({
      where: { entityId: curriculumId, actorId: editor },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(["curriculum.archive", "curriculum.publish"]);
  });
});

describe("D-M6-02: concurrent uploads of the same offline queue", () => {
  it("processes both requests without errors, duplicate attempts or duplicate XP", async () => {
    const user = await newUser();
    const deviceId = randomUUID();
    const ex = await freehand(lesson1);
    const events = [0, 1, 2].map(() => ({
      id: randomUUID(),
      type: "attempt" as const,
      clientCreatedAt: new Date().toISOString(),
      payload: {
        exerciseId: ex.id,
        occurredAt: new Date().toISOString(),
        kind: "writing",
        drawings: [ink(ex.hanzi)],
      },
    }));
    // Two tabs (or a retry racing a slow request) upload the same queue at the same time.
    const [a, b] = await Promise.all([
      processSyncBatch(prisma, user, { deviceId, events }),
      processSyncBatch(prisma, user, { deviceId, events }),
    ]);
    for (const out of [a, b]) {
      expect(out.results.every((r) => r.status === "processed" || r.status === "duplicate")).toBe(
        true,
      );
    }
    expect(await prisma.exerciseAttempt.count({ where: { userId: user } })).toBe(3);
    const xpRows = await prisma.xPTransaction.findMany({ where: { userId: user } });
    expect(new Set(xpRows.map((x) => x.idempotencyKey)).size).toBe(xpRows.length);
    expect(xpRows.filter((x) => x.reason === "EXERCISE_COMPLETED").length).toBeLessThanOrEqual(3);
    expect(await prisma.syncEvent.count({ where: { userId: user } })).toBe(3);
  });

  it("rejects a duplicated event id inside one batch only once it belongs to another user", async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const ex = await freehand(lesson1);
    const event = {
      id: randomUUID(),
      type: "attempt" as const,
      clientCreatedAt: new Date().toISOString(),
      payload: {
        exerciseId: ex.id,
        occurredAt: new Date().toISOString(),
        kind: "writing",
        drawings: [ink(ex.hanzi)],
      },
    };
    await processSyncBatch(prisma, owner, { deviceId: randomUUID(), events: [event] });
    const out = await processSyncBatch(prisma, intruder, {
      deviceId: randomUUID(),
      events: [event],
    });
    expect(out.results[0]).toMatchObject({ status: "rejected" });
    expect(await prisma.exerciseAttempt.count({ where: { userId: intruder } })).toBe(0);
  });
});

describe("account isolation in services", () => {
  it("never mixes one learner's progress into another's", async () => {
    const a = await newUser();
    const b = await newUser();
    const ex = await freehand(lesson1);
    const session = await startLessonSession(prisma, a, lesson1);
    await submitAttempt(prisma, a, writing(ex.id, ex.hanzi, { sessionId: session.id }));

    const summaryA = await getProgressSummary(prisma, a);
    const summaryB = await getProgressSummary(prisma, b);
    expect(summaryA.xpTotal).toBeGreaterThan(0);
    expect(summaryB.xpTotal).toBe(0);
    expect(Object.values(summaryB.mastery).reduce((x, y) => x + y, 0)).toBe(0);
    const detailsB = await getProgressDetails(prisma, b);
    expect(JSON.stringify(detailsB)).not.toContain(ex.hanzi);
    expect(await getLessonState(prisma, b, lesson1)).toBe("AVAILABLE");
  });

  it("refuses to attach an attempt to another learner's session", async () => {
    const a = await newUser();
    const b = await newUser();
    const ex = await freehand(lesson1);
    const session = await startLessonSession(prisma, a, lesson1);
    await expect(
      submitAttempt(prisma, b, writing(ex.id, ex.hanzi, { sessionId: session.id })),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await prisma.exerciseAttempt.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it("does not let an offline lesson.complete adopt another learner's attempts", async () => {
    const a = await newUser();
    const b = await newUser();
    const ex = await freehand(lesson1);
    const attempt = writing(ex.id, ex.hanzi);
    await submitAttempt(prisma, a, attempt);
    const out = await processSyncBatch(prisma, b, {
      deviceId: randomUUID(),
      events: [
        {
          id: randomUUID(),
          type: "lesson.complete",
          clientCreatedAt: new Date().toISOString(),
          payload: { lessonId: lesson1, attemptIds: [attempt.clientEventId] },
        },
      ],
    });
    // B has done none of the work, so the lesson can't complete for B, and A's attempt stays A's.
    expect(out.results[0]!.status).toBe("rejected");
    const stored = await prisma.exerciseAttempt.findUniqueOrThrow({
      where: { clientEventId: attempt.clientEventId },
    });
    expect(stored.userId).toBe(a);
    expect(stored.sessionId).toBeNull();
    expect(await getLessonState(prisma, b, lesson1)).toBe("IN_PROGRESS");
  });
});

describe("duplicate submissions and invalid requests", () => {
  it("returns the stored attempt for a resubmission even after the exercise changed", async () => {
    const user = await newUser();
    const ex = await freehand(lesson1);
    const input = writing(ex.id, ex.hanzi);
    const first = await submitAttempt(prisma, user, input);
    await prisma.exercise.update({ where: { id: ex.id }, data: { status: "ARCHIVED" } });
    try {
      // The retry of an attempt the server already stored must still succeed (offline retry).
      const again = await submitAttempt(prisma, user, input);
      expect(again).toMatchObject({ duplicate: true, attemptId: first.attemptId });
    } finally {
      await prisma.exercise.update({ where: { id: ex.id }, data: { status: "PUBLISHED" } });
    }
  });

  it("rejects malformed attempt payloads without writing anything", async () => {
    const user = await newUser();
    const ex = await freehand(lesson1);
    const bad: unknown[] = [
      null,
      {},
      { ...writing(ex.id, ex.hanzi), clientEventId: "not-a-uuid" },
      { ...writing(ex.id, ex.hanzi), drawings: "x" },
      { ...writing(ex.id, ex.hanzi), occurredAt: "yesterday" },
      { ...writing(ex.id, ex.hanzi), kind: "telepathy" },
      { ...writing(ex.id, ex.hanzi), exerciseId: "x".repeat(10_000) },
    ];
    for (const input of bad) {
      await expect(submitAttempt(prisma, user, input)).rejects.toBeTruthy();
    }
    expect(await prisma.exerciseAttempt.count({ where: { userId: user } })).toBe(0);
    expect(await prisma.xPTransaction.count({ where: { userId: user } })).toBe(0);
  });

  it("completing the same lesson session twice awards lesson XP once", async () => {
    const user = await newUser();
    const session = await startLessonSession(prisma, user, lesson1);
    const exercises = await prisma.lessonExercise.findMany({
      where: { lessonId: lesson1, exercise: { status: "PUBLISHED" } },
      include: { exercise: true },
    });
    for (const { exercise } of exercises) {
      const hanzi = (exercise.evaluationConfig as { characters: string[] }).characters;
      const input =
        exercise.type === "GUIDED_STROKE"
          ? {
              clientEventId: randomUUID(),
              exerciseId: exercise.id,
              occurredAt: new Date().toISOString(),
              kind: "guided",
              mistakes: 0,
              sessionId: session.id,
            }
          : {
              clientEventId: randomUUID(),
              exerciseId: exercise.id,
              occurredAt: new Date().toISOString(),
              kind: "writing",
              drawings: hanzi.map((h, i) => ink(h, i + 2)),
              sessionId: session.id,
            };
      await submitAttempt(prisma, user, input);
    }
    const [first, second] = await Promise.all([
      completeLessonSession(prisma, user, session.id),
      completeLessonSession(prisma, user, session.id),
    ]);
    const awarded = [first.progress?.xpAwarded ?? 0, second.progress?.xpAwarded ?? 0];
    expect(awarded.filter((x) => x > 0)).toHaveLength(1);
    expect(
      await prisma.xPTransaction.count({ where: { userId: user, reason: "LESSON_COMPLETED" } }),
    ).toBe(1);
  });
});
