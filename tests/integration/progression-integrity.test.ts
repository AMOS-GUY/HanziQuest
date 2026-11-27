/**
 * M17 progression-integrity matrix (docs/m17/M17-test-matrix.md).
 *
 * Two kinds of test live here:
 *  - EXPECTED: behaviour the existing rules already require. A failure is a bug.
 *  - CURRENT BEHAVIOUR (F-xx, awaiting owner decision): characterization tests that pin what the
 *    system does today where the policy is undocumented. They are not endorsements. When the
 *    owner approves a policy (docs/m17/M17-locked-practice-policy.md), change the assertion in
 *    the same PR as the implementation.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import {
  generateQuestions,
  getPlacementLevel,
  loadLevelUnits,
  startPlacement,
  submitPlacement,
} from "@/features/assessment/placement";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { submitAttempt } from "@/features/exercises/attempts";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import { completeLessonSession, startLessonSession } from "@/features/learning/sessions";
import { processSyncBatch } from "@/features/offline/sync-service";
import { getLessonState } from "@/features/progression/lesson-states";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;

let curriculumId: string;
let lessonA: string;
let lessonB: string;

function ink(hanzi: string, seed = 1) {
  return toInk(fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians).medians, { seed });
}

async function newUser() {
  const r = await registerUser(prisma, {
    displayName: "M17",
    email: uniqueEmail("m17"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

async function exercisesOf(lessonId: string) {
  return prisma.lessonExercise.findMany({
    where: { lessonId, exercise: { status: "PUBLISHED" } },
    orderBy: { position: "asc" },
    include: { exercise: { include: { character: true } } },
  });
}

/** A single-character free-writing exercise of a lesson (what free character practice uses). */
async function freehandOf(lessonId: string) {
  const row = (await exercisesOf(lessonId)).find(
    (e) => e.exercise.type === "FREEHAND_WRITING" && e.exercise.character,
  );
  if (!row) throw new Error("fixture: no single-character freehand exercise");
  return {
    id: row.exercise.id,
    hanzi: row.exercise.character!.hanzi,
    characterId: row.exercise.characterId!,
  };
}

function writeAttempt(exerciseId: string, hanzi: string, extra: Record<string, unknown> = {}) {
  return {
    clientEventId: randomUUID(),
    exerciseId,
    occurredAt: new Date().toISOString(),
    kind: "writing",
    drawings: [ink(hanzi, 3)],
    ...extra,
  };
}

async function progressCounts(userId: string) {
  const [xp, mastery, schedules, results] = await Promise.all([
    prisma.xPTransaction.aggregate({ where: { userId }, _sum: { amount: true } }),
    prisma.characterMastery.count({ where: { userId } }),
    prisma.reviewSchedule.count({ where: { userId } }),
    prisma.attemptCharacterResult.count({ where: { userId } }),
  ]);
  return { xp: xp._sum.amount ?? 0, mastery, schedules, results };
}

/** Attempts every exercise of a lesson in a session, as the lesson runner does. */
async function practiseWholeLesson(userId: string, lessonId: string, sessionId: string) {
  for (const { exercise } of await exercisesOf(lessonId)) {
    const chars = (exercise.evaluationConfig as { characters: string[] }).characters;
    await submitAttempt(prisma, userId, {
      clientEventId: randomUUID(),
      exerciseId: exercise.id,
      sessionId,
      occurredAt: new Date().toISOString(),
      ...(exercise.type === "GUIDED_STROKE"
        ? { kind: "guided", mistakes: 0 }
        : { kind: "writing", drawings: chars.map((c, i) => ink(c, i + 5)) }),
    });
  }
}

beforeAll(async () => {
  await ensureRoles(prisma);
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `m17-${RUN}`,
        name: "M17 integrity",
        framework: "CUSTOM",
        version: `m17-${RUN}`,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: {
        山: { pinyin: "shān", meaning: "mountain" },
        川: { pinyin: "chuān", meaning: "river" },
      },
      units: [
        {
          slug: "u1",
          title: "U1",
          lessons: [
            {
              slug: "a",
              title: "A",
              words: [{ simplified: "山", pinyin: "shān", meaning: "mountain" }],
            },
            {
              slug: "b",
              title: "B",
              words: [{ simplified: "川", pinyin: "chuān", meaning: "river" }],
            },
          ],
        },
      ],
    },
    loadStrokeData,
  );
  expect(content.issues.filter((i) => i.severity === "error")).toEqual([]);
  const summary = await importCurriculumContent(prisma, content.content!, {
    publishNewLessons: true,
    lookupStrokes: loadStrokeData,
  });
  curriculumId = summary.curriculumId;
  const lessons = await prisma.lesson.findMany({
    where: { unit: { level: { curriculumId } } },
    orderBy: { position: "asc" },
  });
  [lessonA, lessonB] = lessons.map((l) => l.id) as [string, string];
});

afterAll(async () => {
  // Keep later runs (and other files' "all published curricula" queries) unaffected.
  await prisma.curriculum.update({ where: { id: curriculumId }, data: { status: "ARCHIVED" } });
  await prisma.$disconnect();
});

describe("F-01 locked-lesson content: CURRENT BEHAVIOUR (awaiting owner decision)", () => {
  it("the lesson routes refuse a locked lesson (controls)", async () => {
    const userId = await newUser();
    expect(await getLessonState(prisma, userId, lessonB)).toBe("LOCKED");
    await expect(startLessonSession(prisma, userId, lessonB)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("a session-less attempt on a locked lesson's character is graded and counts", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    const before = await progressCounts(userId);
    const out = await submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi));
    expect(await getLessonState(prisma, userId, lessonB)).toBe("LOCKED");
    expect(out.result).toBe("EXCELLENT");
    // Today: 10 XP, a mastery row and a review schedule for a character of a locked lesson.
    expect(out.xpAwarded).toBe(10);
    const after = await progressCounts(userId);
    expect(after.xp - before.xp).toBeGreaterThanOrEqual(10);
    expect(after.mastery).toBe(before.mastery + 1);
    expect(after.schedules).toBe(before.schedules + 1);
  });

  it("the same applies through another lesson's session and through offline sync", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    const session = await startLessonSession(prisma, userId, lessonA);
    // An attempt may name any session the learner owns; the exercise needn't belong to it.
    const viaSession = await submitAttempt(
      prisma,
      userId,
      writeAttempt(ex.id, ex.hanzi, { sessionId: session.id }),
    );
    expect(viaSession.xpAwarded).toBeGreaterThan(0);

    const other = await newUser();
    const { results } = await processSyncBatch(prisma, other, {
      deviceId: randomUUID(),
      events: [
        {
          id: randomUUID(),
          type: "attempt",
          clientCreatedAt: new Date().toISOString(),
          payload: writeAttempt(ex.id, ex.hanzi),
        },
      ],
    });
    expect(results[0]).toMatchObject({ status: "processed", result: { xpAwarded: 10 } });
    // Offline download of the locked lesson itself is refused by the download route
    // (getLessonState === "LOCKED"); the attempt path doesn't check lesson state at all.
  });

  it("an attempt in a foreign session doesn't help complete the session's own lesson", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    const session = await startLessonSession(prisma, userId, lessonA);
    await submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi, { sessionId: session.id }));
    await expect(completeLessonSession(prisma, userId, session.id)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await getLessonState(prisma, userId, lessonB)).toBe("LOCKED");
  });
});

describe("F-02 client-supplied attempt time: CURRENT BEHAVIOUR (awaiting owner decision)", () => {
  it("backdated attempts replay as spaced reviews: FAMILIAR or better and a multi-day streak in one sitting", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const now = Date.now();
    // Start 25 days ago (inside the accepted 30-day window) and always "write it again" at the
    // moment the schedule says it is due. Every request is made now.
    let at = now - 25 * DAY;
    const days = new Set<string>();
    for (let i = 0; i < 6 && at < now; i += 1) {
      await submitAttempt(prisma, userId, {
        ...writeAttempt(ex.id, ex.hanzi),
        occurredAt: new Date(at).toISOString(),
      });
      days.add(new Date(at).toISOString().slice(0, 10));
      const schedule = await prisma.reviewSchedule.findUniqueOrThrow({
        where: { userId_characterId: { userId, characterId: ex.characterId } },
      });
      at = schedule.dueAt.getTime() + 60_000;
    }
    const mastery = await prisma.characterMastery.findUniqueOrThrow({
      where: { userId_characterId: { userId, characterId: ex.characterId } },
    });
    expect(["FAMILIAR", "MASTERED"]).toContain(mastery.level);
    expect(days.size).toBeGreaterThanOrEqual(3);
    // XP was booked on several past days, so per-day caps apply per backdated day.
    const activityDays = await prisma.dailyActivity.count({
      where: { userId, exercisesCompleted: { gt: 0 } },
    });
    expect(activityDays).toBeGreaterThanOrEqual(3);
  });

  it("the accepted window itself is enforced (control)", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    for (const occurredAt of [
      new Date(Date.now() - 31 * DAY).toISOString(),
      new Date(Date.now() + 10 * 60_000).toISOString(),
    ]) {
      await expect(
        submitAttempt(prisma, userId, { ...writeAttempt(ex.id, ex.hanzi), occurredAt }),
      ).rejects.toMatchObject({ code: "conflict" });
    }
  });
});

describe("EXPECTED: lesson completion follows publication", () => {
  it("a lesson unpublished after its session started can't be completed and earns nothing", async () => {
    const userId = await newUser();
    const session = await startLessonSession(prisma, userId, lessonA);
    await practiseWholeLesson(userId, lessonA, session.id);
    const before = await prisma.xPTransaction.count({
      where: { userId, reason: "LESSON_COMPLETED" },
    });
    await prisma.lesson.update({ where: { id: lessonA }, data: { status: "DRAFT" } });
    try {
      await expect(completeLessonSession(prisma, userId, session.id)).rejects.toMatchObject({
        code: "not_found",
      });
      expect(
        await prisma.xPTransaction.count({ where: { userId, reason: "LESSON_COMPLETED" } }),
      ).toBe(before);
      expect(
        (
          await prisma.lessonProgress.findUnique({
            where: { userId_lessonId: { userId, lessonId: lessonA } },
          })
        )?.status,
      ).not.toBe("COMPLETED");
    } finally {
      await prisma.lesson.update({ where: { id: lessonA }, data: { status: "PUBLISHED" } });
    }
    // Republished, the same session completes normally (nothing was lost).
    const done = await completeLessonSession(prisma, userId, session.id);
    expect(done.progress?.xpAwarded).toBeGreaterThan(0);
  });

  it("an archived curriculum's lesson can't be completed either", async () => {
    const userId = await newUser();
    const session = await startLessonSession(prisma, userId, lessonA);
    await practiseWholeLesson(userId, lessonA, session.id);
    await prisma.curriculum.update({ where: { id: curriculumId }, data: { status: "ARCHIVED" } });
    try {
      await expect(completeLessonSession(prisma, userId, session.id)).rejects.toMatchObject({
        code: "not_found",
      });
    } finally {
      await prisma.curriculum.update({
        where: { id: curriculumId },
        data: { status: "PUBLISHED" },
      });
    }
  });
});

describe("EXPECTED: a placement check is graded once", () => {
  async function plan(userId: string) {
    const { assessmentId } = await startPlacement(prisma, userId);
    const level = (await getPlacementLevel(prisma))!;
    const units = await loadLevelUnits(prisma, level.id);
    return { assessmentId, units, questions: generateQuestions(assessmentId, units) };
  }

  it("two concurrent submissions of the same check: one is graded, the other refused", async () => {
    const userId = await newUser();
    const { assessmentId, questions } = await plan(userId);
    const answers = questions.map(() => null);
    const settled = await Promise.allSettled([
      submitPlacement(prisma, userId, assessmentId, answers),
      submitPlacement(prisma, userId, assessmentId, answers),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const refused = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "conflict" });
    expect(await prisma.assessmentResult.count({ where: { assessmentId } })).toBe(questions.length);
  });

  it("concurrent submissions that test out lessons: one applies, the other is refused (not a 500)", async () => {
    const userId = await newUser();
    const { assessmentId, units, questions } = await plan(userId);
    const first = units[0]!.unitId;
    const answers = questions.map((q) => (q.unitId === first ? q.correctIndex : null));
    const settled = await Promise.allSettled([
      submitPlacement(prisma, userId, assessmentId, answers),
      submitPlacement(prisma, userId, assessmentId, answers),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const refused = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: "conflict" });
    expect(await prisma.assessmentResult.count({ where: { assessmentId } })).toBe(questions.length);
  });
});
