/**
 * Progression-integrity matrix: M17 audit (docs/m17) and M18 enforcement of D-085 (docs/m18).
 *
 * Every case asserts persisted rows, not only responses. Groups:
 *  - F-01 preview practice: content the learner hasn't reached is graded, never counted.
 *  - F-06 session context: an attempt must fit the session it names.
 *  - F-02 online time: the server's clock is authoritative.
 *  - F-02 offline time: the device's clock counts only after server-recorded offline access.
 *  - F-03 / F-04 (M17): completion follows publication; placement is graded once.
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
import {
  completeLessonSession,
  startLessonSession,
  startReviewSession,
} from "@/features/learning/sessions";
import { recordLessonDownload } from "@/features/offline/downloads";
import { processSyncBatch } from "@/features/offline/sync-service";
import { ACHIEVEMENTS } from "@/features/progress/achievements";
import { localDay } from "@/features/progress/calendar";
import { getLessonState } from "@/features/progression/lesson-states";
import type { Prisma } from "@/generated/prisma/client";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60_000;

let curriculumId: string;
let curriculumY: string;
/** Curriculum X: A (山) → B (川) → C (山川). */
let lessonA: string;
let lessonB: string;
let lessonC: string;
/** Curriculum Y: Y1 (水) → Y2 (山, shared with X's lesson A). */
let lessonY2: string;

function ink(hanzi: string, seed = 1) {
  return toInk(fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians).medians, { seed });
}

async function newUser(timezone?: string) {
  const r = await registerUser(prisma, {
    displayName: "M17",
    email: uniqueEmail("m17"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  if (timezone)
    await prisma.profile.upsert({
      where: { userId: r.userId },
      create: { userId: r.userId, displayName: "M17", timezone },
      update: { timezone },
    });
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

/** A multi-character writing exercise of a lesson (a word). */
async function wordOf(lessonId: string) {
  const row = (await exercisesOf(lessonId)).find(
    (e) =>
      e.exercise.type !== "GUIDED_STROKE" &&
      (e.exercise.evaluationConfig as { characters: string[] }).characters.length > 1,
  );
  if (!row) throw new Error("fixture: no word exercise");
  return {
    id: row.exercise.id,
    characters: (row.exercise.evaluationConfig as { characters: string[] }).characters,
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

/** Every progression side effect a learner can have. */
async function sideEffects(userId: string) {
  const [xp, results, mastery, schedules, activity, streak, achievements, completed] =
    await Promise.all([
      prisma.xPTransaction.count({ where: { userId } }),
      prisma.attemptCharacterResult.count({ where: { userId } }),
      prisma.characterMastery.count({ where: { userId } }),
      prisma.reviewSchedule.count({ where: { userId } }),
      prisma.dailyActivity.count({ where: { userId } }),
      prisma.streak
        .findUnique({ where: { userId } })
        // Registration creates the row; what matters is its length.
        .then((row) => (row?.currentLength ?? 0) + (row?.longestLength ?? 0)),
      prisma.userAchievement.count({ where: { userId } }),
      prisma.lessonProgress.count({ where: { userId, status: "COMPLETED" } }),
    ]);
  return { xp, results, mastery, schedules, activity, streak, achievements, completed };
}
const NONE = {
  xp: 0,
  results: 0,
  mastery: 0,
  schedules: 0,
  activity: 0,
  streak: 0,
  achievements: 0,
  completed: 0,
};

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

/** A device that downloaded `lessonId` at `firstDownloadedAt` (what the download route records). */
async function deviceWithDownload(userId: string, lessonId: string, firstDownloadedAt: Date) {
  const clientId = randomUUID();
  const device = await prisma.device.create({ data: { userId, clientId } });
  await prisma.downloadedContentVersion.create({
    data: {
      userId,
      deviceId: device.id,
      lessonId,
      contentVersion: 1,
      firstDownloadedAt,
      downloadedAt: firstDownloadedAt,
    },
  });
  return { clientId, deviceId: device.id };
}

function syncAttempt(payload: Record<string, unknown>) {
  return {
    id: randomUUID(),
    type: "attempt" as const,
    clientCreatedAt: new Date().toISOString(),
    payload,
  };
}

async function importCurriculum(
  slug: string,
  characters: Record<string, object>,
  lessons: object[],
) {
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `${slug}-${RUN}`,
        name: `M18 ${slug}`,
        framework: "CUSTOM",
        version: `${slug}-${RUN}`,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters,
      units: [{ slug: "u1", title: "U1", lessons }],
    },
    loadStrokeData,
  );
  expect(content.issues.filter((i) => i.severity === "error")).toEqual([]);
  const summary = await importCurriculumContent(prisma, content.content!, {
    publishNewLessons: true,
    lookupStrokes: loadStrokeData,
  });
  const rows = await prisma.lesson.findMany({
    where: { unit: { level: { curriculumId: summary.curriculumId } } },
    orderBy: { position: "asc" },
  });
  return { curriculumId: summary.curriculumId, lessons: rows.map((l) => l.id) };
}

beforeAll(async () => {
  await ensureRoles(prisma);
  for (const a of ACHIEVEMENTS) {
    const data = { ...a, criteria: a.criteria as Prisma.InputJsonValue };
    await prisma.achievement.upsert({ where: { key: a.key }, create: data, update: data });
  }
  const x = await importCurriculum(
    "m17",
    { 山: { pinyin: "shān", meaning: "mountain" }, 川: { pinyin: "chuān", meaning: "river" } },
    [
      { slug: "a", title: "A", words: [{ simplified: "山", pinyin: "shān", meaning: "mountain" }] },
      { slug: "b", title: "B", words: [{ simplified: "川", pinyin: "chuān", meaning: "river" }] },
      {
        slug: "c",
        title: "C",
        words: [{ simplified: "山川", pinyin: "shānchuān", meaning: "landscape" }],
      },
    ],
  );
  curriculumId = x.curriculumId;
  [lessonA, lessonB, lessonC] = x.lessons as [string, string, string];
  const y = await importCurriculum(
    "m18y",
    { 水: { pinyin: "shuǐ", meaning: "water" }, 山: { pinyin: "shān", meaning: "mountain" } },
    [
      { slug: "y1", title: "Y1", words: [{ simplified: "水", pinyin: "shuǐ", meaning: "water" }] },
      {
        slug: "y2",
        title: "Y2",
        words: [{ simplified: "山", pinyin: "shān", meaning: "mountain" }],
      },
    ],
  );
  curriculumY = y.curriculumId;
  lessonY2 = y.lessons[1]!;
});

afterAll(async () => {
  // Keep later runs (and other files' "all published curricula" queries) unaffected.
  await prisma.curriculum.updateMany({
    where: { id: { in: [curriculumId, curriculumY] } },
    data: { status: "ARCHIVED" },
  });
  await prisma.$disconnect();
});

describe("F-01 preview practice of locked content (D-085)", () => {
  it("is graded with feedback and stored as a preview, with no progression side effect", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    expect(await getLessonState(prisma, userId, lessonB)).toBe("LOCKED");
    const out = await submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi));
    // Feedback: the server's own evaluation and band.
    expect(out.result).toBe("EXCELLENT");
    expect(out.evaluation).toMatchObject({ band: "EXCELLENT" });
    expect(out).toMatchObject({ counted: false, xpAwarded: 0, progress: null, duplicate: false });
    const stored = await prisma.exerciseAttempt.findUniqueOrThrow({ where: { id: out.attemptId } });
    expect(stored).toMatchObject({ countsForProgress: false, xpAwarded: 0, result: "EXCELLENT" });
    // No XP, character results (mastery history), mastery, schedule, activity, streak,
    // achievement or completion.
    expect(await sideEffects(userId)).toEqual(NONE);
    // Nothing unlocks; the lesson still can't be started.
    expect(await getLessonState(prisma, userId, lessonB)).toBe("LOCKED");
    await expect(startLessonSession(prisma, userId, lessonB)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("retries and duplicates stay previews", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    const body = writeAttempt(ex.id, ex.hanzi);
    const first = await submitAttempt(prisma, userId, body);
    const again = await submitAttempt(prisma, userId, body);
    const raced = await Promise.all([
      submitAttempt(prisma, userId, body),
      submitAttempt(prisma, userId, body),
    ]);
    for (const o of [again, ...raced])
      expect(o).toMatchObject({
        attemptId: first.attemptId,
        duplicate: true,
        counted: false,
        xpAwarded: 0,
      });
    expect(await prisma.exerciseAttempt.count({ where: { userId } })).toBe(1);
    expect(await sideEffects(userId)).toEqual(NONE);
  });

  it("forged client flags change nothing", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    const out = await submitAttempt(
      prisma,
      userId,
      writeAttempt(ex.id, ex.hanzi, {
        preview: false,
        isPreview: false,
        locked: false,
        counted: true,
        countsForProgress: true,
        practiceMode: "lesson",
        freePractice: false,
        xpAwarded: 100,
        score: 100,
      }),
    );
    expect(out).toMatchObject({ counted: false, xpAwarded: 0 });
    expect(await sideEffects(userId)).toEqual(NONE);
  });

  it("offline sync can't turn a preview into progress", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId: randomUUID(),
      events: [syncAttempt(writeAttempt(ex.id, ex.hanzi))],
    });
    expect(results[0]).toMatchObject({ status: "processed", result: { xpAwarded: 0 } });
    expect(
      await prisma.exerciseAttempt.count({ where: { userId, countsForProgress: false } }),
    ).toBe(1);
    expect(await sideEffects(userId)).toEqual(NONE);
  });

  it("a reached lesson's attempt counts as before (control)", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const out = await submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi));
    expect(out).toMatchObject({ counted: true, xpAwarded: 10 });
    const after = await sideEffects(userId);
    expect(after).toMatchObject({ results: 1, mastery: 1, schedules: 1, activity: 1 });
    expect(after.streak).toBeGreaterThan(0);
    expect(after.achievements).toBeGreaterThan(0); // first-character
  });

  it("a character shared with a reached lesson elsewhere counts, whichever exercise is used", async () => {
    const userId = await newUser();
    // Y2 (山) is locked in curriculum Y, but 山 is reached in X (lesson A is available).
    expect(await getLessonState(prisma, userId, lessonY2)).toBe("LOCKED");
    const ex = await freehandOf(lessonY2);
    const out = await submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi));
    expect(out).toMatchObject({ counted: true, xpAwarded: 10 });
    expect(await getLessonState(prisma, userId, lessonY2)).toBe("LOCKED");
  });

  it("a word with one unreached character is a preview", async () => {
    const userId = await newUser();
    const word = await wordOf(lessonC); // 山川: 山 reached (A), 川 not (B is locked)
    const out = await submitAttempt(prisma, userId, {
      clientEventId: randomUUID(),
      exerciseId: word.id,
      occurredAt: new Date().toISOString(),
      kind: "writing",
      drawings: word.characters.map((c, i) => ink(c, i + 3)),
    });
    expect(out.counted).toBe(false);
    expect(await sideEffects(userId)).toEqual(NONE);
  });

  it("once the lesson is reached, attempts count, and earlier previews are never credited", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    await submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi)); // preview
    const session = await startLessonSession(prisma, userId, lessonA);
    await practiseWholeLesson(userId, lessonA, session.id);
    await completeLessonSession(prisma, userId, session.id);
    expect(await getLessonState(prisma, userId, lessonB)).toBe("AVAILABLE");
    const out = await submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi));
    expect(out.counted).toBe(true);
    const mastery = await prisma.characterMastery.findUniqueOrThrow({
      where: { userId_characterId: { userId, characterId: ex.characterId } },
    });
    expect(mastery.independentAttempts).toBe(1);
  });
});

describe("F-06 an attempt must fit the session it names (D-085)", () => {
  it("accepts the session's own lesson", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const session = await startLessonSession(prisma, userId, lessonA);
    const out = await submitAttempt(
      prisma,
      userId,
      writeAttempt(ex.id, ex.hanzi, { sessionId: session.id, lessonId: lessonA }),
    );
    expect(out.counted).toBe(true);
    const stored = await prisma.exerciseAttempt.findUniqueOrThrow({ where: { id: out.attemptId } });
    expect(stored.sessionId).toBe(session.id);
  });

  it("refuses another learner's session", async () => {
    const owner = await newUser();
    const other = await newUser();
    const session = await startLessonSession(prisma, owner, lessonA);
    const ex = await freehandOf(lessonA);
    await expect(
      submitAttempt(prisma, other, writeAttempt(ex.id, ex.hanzi, { sessionId: session.id })),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await prisma.exerciseAttempt.count({ where: { userId: other } })).toBe(0);
  });

  it("refuses exercises of other lessons, locked or not, and unrelated curricula", async () => {
    const userId = await newUser();
    const session = await startLessonSession(prisma, userId, lessonA);
    for (const lessonId of [lessonB, lessonY2]) {
      const ex = await freehandOf(lessonId);
      await expect(
        submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi, { sessionId: session.id })),
      ).rejects.toMatchObject({ code: "conflict" });
    }
    expect(await prisma.exerciseAttempt.count({ where: { userId } })).toBe(0);
    expect(await sideEffects(userId)).toEqual(NONE);
  });

  it("refuses a lesson id that doesn't match the session or the exercise", async () => {
    const userId = await newUser();
    const session = await startLessonSession(prisma, userId, lessonA);
    const ex = await freehandOf(lessonA);
    await expect(
      submitAttempt(
        prisma,
        userId,
        writeAttempt(ex.id, ex.hanzi, { sessionId: session.id, lessonId: lessonB }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi, { lessonId: lessonB })),
    ).rejects.toMatchObject({ code: "conflict" });
    // A locked lesson's exercise claiming a reached lesson is refused, not counted.
    const locked = await freehandOf(lessonB);
    await expect(
      submitAttempt(prisma, userId, writeAttempt(locked.id, locked.hanzi, { lessonId: lessonA })),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await prisma.exerciseAttempt.count({ where: { userId } })).toBe(0);
  });

  it("refuses a finished session; a retry of an attempt already stored is still idempotent", async () => {
    const userId = await newUser();
    const session = await startLessonSession(prisma, userId, lessonA);
    const ex = await freehandOf(lessonA);
    const body = writeAttempt(ex.id, ex.hanzi, { sessionId: session.id });
    const first = await submitAttempt(prisma, userId, body);
    await practiseWholeLesson(userId, lessonA, session.id);
    await completeLessonSession(prisma, userId, session.id);
    await expect(
      submitAttempt(prisma, userId, writeAttempt(ex.id, ex.hanzi, { sessionId: session.id })),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await submitAttempt(prisma, userId, body)).toMatchObject({
      attemptId: first.attemptId,
      duplicate: true,
    });
  });

  it("a review session only takes characters the learner is reviewing", async () => {
    const userId = await newUser();
    const a = await freehandOf(lessonA);
    await submitAttempt(prisma, userId, writeAttempt(a.id, a.hanzi), {
      now: new Date(Date.now() - 2 * DAY),
    });
    const { session } = await startReviewSession(prisma, userId);
    const b = await freehandOf(lessonB);
    await expect(
      submitAttempt(prisma, userId, writeAttempt(b.id, b.hanzi, { sessionId: session.id })),
    ).rejects.toMatchObject({ code: "conflict" });
    const out = await submitAttempt(
      prisma,
      userId,
      writeAttempt(a.id, a.hanzi, { sessionId: session.id }),
    );
    expect(out.counted).toBe(true);
    expect(
      await prisma.xPTransaction.count({ where: { userId, reason: "REVIEW_COMPLETED" } }),
    ).toBe(1);
  });

  it("offline completion attaches only the lesson's own counted attempts", async () => {
    const userId = await newUser();
    const deviceId = randomUUID();
    // Every exercise of lesson A but one, plus a preview of lesson B, all offline.
    const aExercises = await exercisesOf(lessonA);
    const events = aExercises.slice(1).map(({ exercise }) => {
      const chars = (exercise.evaluationConfig as { characters: string[] }).characters;
      return syncAttempt({
        exerciseId: exercise.id,
        occurredAt: new Date().toISOString(),
        ...(exercise.type === "GUIDED_STROKE"
          ? { kind: "guided", mistakes: 0 }
          : { kind: "writing", drawings: chars.map((c, i) => ink(c, i + 5)) }),
      });
    });
    const b = await freehandOf(lessonB);
    events.push(syncAttempt(writeAttempt(b.id, b.hanzi)));
    const complete = {
      id: randomUUID(),
      type: "lesson.complete" as const,
      clientCreatedAt: new Date().toISOString(),
      payload: { lessonId: lessonA, sessionId: null, attemptIds: events.map((e) => e.id) },
    };
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId,
      events: [...events, complete],
    });
    expect(results.at(-1)).toMatchObject({ status: "rejected" });
    const preview = await prisma.exerciseAttempt.findFirstOrThrow({
      where: { userId, countsForProgress: false },
    });
    expect(preview.sessionId).toBeNull();
    expect(await prisma.lessonProgress.count({ where: { userId, status: "COMPLETED" } })).toBe(0);
  });
});

describe("F-02 online attempts take the server's time (D-085)", () => {
  it("ignores a backdated, future or skewed client clock, keeping it as diagnostic data", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    for (const claimed of [
      new Date(Date.now() - 25 * DAY),
      new Date(Date.now() + 3 * 60 * MINUTE),
      new Date(Date.now() - 7 * MINUTE),
    ]) {
      const before = Date.now();
      const out = await submitAttempt(
        prisma,
        userId,
        writeAttempt(ex.id, ex.hanzi, { occurredAt: claimed.toISOString() }),
      );
      const stored = await prisma.exerciseAttempt.findUniqueOrThrow({
        where: { id: out.attemptId },
      });
      expect(stored.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(stored.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(stored.clientOccurredAt?.toISOString()).toBe(claimed.toISOString());
      const results = await prisma.attemptCharacterResult.findMany({
        where: { attemptId: out.attemptId },
      });
      expect(results.every((r) => r.occurredAt.getTime() === stored.occurredAt.getTime())).toBe(
        true,
      );
    }
  });

  it("a backdated 'spaced' sequence no longer builds mastery, streak days or past activity (M17 F-02)", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    let at = Date.now() - 25 * DAY;
    for (let i = 0; i < 6; i += 1) {
      await submitAttempt(
        prisma,
        userId,
        writeAttempt(ex.id, ex.hanzi, { occurredAt: new Date(at).toISOString() }),
      );
      const schedule = await prisma.reviewSchedule.findUniqueOrThrow({
        where: { userId_characterId: { userId, characterId: ex.characterId } },
      });
      at = schedule.dueAt.getTime() + MINUTE;
      if (at > Date.now()) at = Date.now() - 25 * DAY; // keep trying to forge the past
    }
    const mastery = await prisma.characterMastery.findUniqueOrThrow({
      where: { userId_characterId: { userId, characterId: ex.characterId } },
    });
    expect(mastery.level).toBe("LEARNING");
    expect(await prisma.dailyActivity.count({ where: { userId } })).toBe(1);
    const streak = await prisma.streak.findUniqueOrThrow({ where: { userId } });
    expect(streak.currentLength).toBe(1);
    // The daily goal and caps are booked today, the only day the server saw.
    const days = await prisma.exerciseAttempt.groupBy({ by: ["localDate"], where: { userId } });
    expect(days).toHaveLength(1);
  });

  it("duplicates stay idempotent", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const body = writeAttempt(ex.id, ex.hanzi, {
      occurredAt: new Date(Date.now() - 3 * DAY).toISOString(),
    });
    const first = await submitAttempt(prisma, userId, body);
    const again = await submitAttempt(prisma, userId, body);
    expect(again).toMatchObject({ attemptId: first.attemptId, duplicate: true });
    expect(await prisma.xPTransaction.count({ where: { userId, sourceType: "attempt" } })).toBe(1);
  });
});

describe("F-02 offline attempts keep their time only after server-recorded access (D-085)", () => {
  it("accepts a downloaded lesson practised offline days ago, at its own time", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const dev = await deviceWithDownload(userId, lessonA, new Date(Date.now() - 5 * DAY));
    const at = new Date(Date.now() - 4 * DAY);
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId: dev.clientId,
      events: [syncAttempt(writeAttempt(ex.id, ex.hanzi, { occurredAt: at.toISOString() }))],
    });
    expect(results[0]).toMatchObject({ status: "processed", result: { xpAwarded: 10 } });
    const stored = await prisma.exerciseAttempt.findFirstOrThrow({ where: { userId } });
    expect(stored.occurredAt.toISOString()).toBe(at.toISOString());
    expect(stored.deviceId).toBe(dev.deviceId);
  });

  it("rejects attempts dated before the device had the lesson, keeps the rest of the batch, and a retry changes nothing", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const downloaded = new Date(Date.now() - 5 * DAY);
    const dev = await deviceWithDownload(userId, lessonA, downloaded);
    const events = [
      syncAttempt(
        writeAttempt(ex.id, ex.hanzi, { occurredAt: new Date(Date.now() - 4 * DAY).toISOString() }),
      ),
      syncAttempt(
        writeAttempt(ex.id, ex.hanzi, {
          occurredAt: new Date(downloaded.getTime() - DAY).toISOString(),
        }),
      ),
      syncAttempt(
        writeAttempt(ex.id, ex.hanzi, { occurredAt: new Date(Date.now() - 2 * DAY).toISOString() }),
      ),
    ];
    const first = await processSyncBatch(prisma, userId, { deviceId: dev.clientId, events });
    expect(first.results.map((r) => r.status)).toEqual(["processed", "rejected", "processed"]);
    expect(first.results[1]!.error).toMatch(/before this device had the lesson/);
    const xp = await prisma.xPTransaction.count({ where: { userId } });
    const retry = await processSyncBatch(prisma, userId, { deviceId: dev.clientId, events });
    expect(retry.results.map((r) => r.status)).toEqual(["duplicate", "rejected", "duplicate"]);
    expect(await prisma.xPTransaction.count({ where: { userId } })).toBe(xp);
    expect(await prisma.exerciseAttempt.count({ where: { userId } })).toBe(2);
  });

  it("a manipulated spaced history before the download is refused entirely", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const dev = await deviceWithDownload(userId, lessonA, new Date(Date.now() - 2 * DAY));
    const events = [25, 24, 21, 14, 3].map((d) =>
      syncAttempt(
        writeAttempt(ex.id, ex.hanzi, { occurredAt: new Date(Date.now() - d * DAY).toISOString() }),
      ),
    );
    const { results } = await processSyncBatch(prisma, userId, { deviceId: dev.clientId, events });
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(await sideEffects(userId)).toEqual(NONE);
  });

  it("allows clock skew at the boundary, clamps future times, and keeps the 30-day limit", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const downloaded = new Date(Date.now() - 3 * DAY);
    const dev = await deviceWithDownload(userId, lessonA, downloaded);
    const within = new Date(downloaded.getTime() - 4 * MINUTE);
    const outside = new Date(downloaded.getTime() - 6 * MINUTE);
    const future = new Date(Date.now() + 2 * 60 * MINUTE);
    const events = [within, outside, future].map((t) =>
      syncAttempt(writeAttempt(ex.id, ex.hanzi, { occurredAt: t.toISOString() })),
    );
    const before = Date.now();
    const { results } = await processSyncBatch(prisma, userId, { deviceId: dev.clientId, events });
    expect(results.map((r) => r.status)).toEqual(["processed", "rejected", "processed"]);
    const stored = await prisma.exerciseAttempt.findMany({
      where: { userId },
      orderBy: { receivedAt: "asc" },
    });
    expect(stored[0]!.occurredAt.toISOString()).toBe(within.toISOString());
    expect(stored[1]!.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored[1]!.occurredAt.getTime()).toBeLessThan(future.getTime());
    expect(stored[1]!.clientOccurredAt?.toISOString()).toBe(future.toISOString());

    const old = await deviceWithDownload(userId, lessonA, new Date(Date.now() - 40 * DAY));
    const tooOld = await processSyncBatch(prisma, userId, {
      deviceId: old.clientId,
      events: [
        syncAttempt(
          writeAttempt(ex.id, ex.hanzi, {
            occurredAt: new Date(Date.now() - 31 * DAY).toISOString(),
          }),
        ),
      ],
    });
    expect(tooOld.results[0]).toMatchObject({ status: "rejected" });
  });

  it("uses the session start as evidence for a lesson that lost the network mid-way", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const session = await startLessonSession(prisma, userId, lessonA);
    const deviceId = randomUUID();
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId,
      events: [
        syncAttempt(
          writeAttempt(ex.id, ex.hanzi, {
            sessionId: session.id,
            occurredAt: new Date(session.startedAt.getTime() - 60 * MINUTE).toISOString(),
          }),
        ),
        syncAttempt(
          writeAttempt(ex.id, ex.hanzi, {
            sessionId: session.id,
            occurredAt: new Date(session.startedAt.getTime() + MINUTE).toISOString(),
          }),
        ),
      ],
    });
    expect(results.map((r) => r.status)).toEqual(["rejected", "processed"]);
  });

  it("with no server-recorded access, uses the server's time", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const before = Date.now();
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId: randomUUID(),
      events: [
        syncAttempt(
          writeAttempt(ex.id, ex.hanzi, {
            occurredAt: new Date(Date.now() - 10 * DAY).toISOString(),
          }),
        ),
      ],
    });
    expect(results[0]).toMatchObject({ status: "processed" });
    const stored = await prisma.exerciseAttempt.findFirstOrThrow({ where: { userId } });
    expect(stored.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(await prisma.dailyActivity.count({ where: { userId } })).toBe(1);
  });

  it("books an accepted offline attempt on the learner's local day of its validated time", async () => {
    const userId = await newUser("Asia/Shanghai");
    const ex = await freehandOf(lessonA);
    const dev = await deviceWithDownload(userId, lessonA, new Date(Date.now() - 5 * DAY));
    // 23:30 UTC two days ago is already the next calendar day in Shanghai (UTC+8).
    const at = new Date(Date.now() - 2 * DAY);
    at.setUTCHours(23, 30, 0, 0);
    await processSyncBatch(prisma, userId, {
      deviceId: dev.clientId,
      events: [syncAttempt(writeAttempt(ex.id, ex.hanzi, { occurredAt: at.toISOString() }))],
    });
    const stored = await prisma.exerciseAttempt.findFirstOrThrow({ where: { userId } });
    expect(stored.localDate?.toISOString().slice(0, 10)).toBe(localDay(at, "Asia/Shanghai"));
    expect(localDay(at, "Asia/Shanghai")).not.toBe(at.toISOString().slice(0, 10));
  });

  it("a downloaded locked lesson can't exist, and an offline locked attempt is a preview", async () => {
    const userId = await newUser();
    const ex = await freehandOf(lessonB);
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId: randomUUID(),
      events: [syncAttempt(writeAttempt(ex.id, ex.hanzi))],
    });
    expect(results[0]).toMatchObject({ status: "processed", result: { xpAwarded: 0 } });
    expect(await sideEffects(userId)).toEqual(NONE);
  });
});

describe("D-085 review: offline authorization can't be stretched", () => {
  async function latestAttempt(userId: string) {
    return prisma.exerciseAttempt.findFirstOrThrow({
      where: { userId },
      orderBy: { receivedAt: "desc" },
    });
  }

  it("re-downloads keep the first download time; each learner and device has its own", async () => {
    const userId = await newUser();
    const clientDeviceId = randomUUID();
    const first = new Date(Date.now() - 10 * DAY);
    await recordLessonDownload(
      prisma,
      { userId, clientDeviceId, lessonId: lessonA, contentVersion: 1 },
      first,
    );
    const again = await recordLessonDownload(prisma, {
      userId,
      clientDeviceId,
      lessonId: lessonA,
      contentVersion: 2,
    });
    expect(again.firstDownloadedAt.toISOString()).toBe(first.toISOString());
    expect(again.downloadedAt.getTime()).toBeGreaterThan(first.getTime());
    expect(again.contentVersion).toBe(2);
    // The service never moves the first time, whichever time a later call carries.
    const earlier = await recordLessonDownload(
      prisma,
      { userId, clientDeviceId, lessonId: lessonA, contentVersion: 2 },
      new Date(Date.now() - 20 * DAY),
    );
    expect(earlier.firstDownloadedAt.toISOString()).toBe(first.toISOString());
    // Another learner with the same client device id gets a separate device and window.
    const other = await newUser();
    const theirs = await recordLessonDownload(prisma, {
      userId: other,
      clientDeviceId,
      lessonId: lessonA,
      contentVersion: 2,
    });
    expect(theirs.deviceId).not.toBe(again.deviceId);
    expect(theirs.firstDownloadedAt.getTime()).toBeGreaterThan(first.getTime());
  });

  it("a download of one lesson doesn't authorize old times for a locked lesson's exercise", async () => {
    const userId = await newUser();
    const clientDeviceId = randomUUID();
    await recordLessonDownload(
      prisma,
      { userId, clientDeviceId, lessonId: lessonA, contentVersion: 1 },
      new Date(Date.now() - 10 * DAY),
    );
    const b = await freehandOf(lessonB);
    const before = Date.now();
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId: clientDeviceId,
      events: [
        syncAttempt(
          writeAttempt(b.id, b.hanzi, { occurredAt: new Date(Date.now() - 5 * DAY).toISOString() }),
        ),
      ],
    });
    expect(results[0]).toMatchObject({ status: "processed", result: { xpAwarded: 0 } });
    const stored = await latestAttempt(userId);
    expect(stored.countsForProgress).toBe(false);
    expect(stored.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(await sideEffects(userId)).toEqual(NONE);
  });

  it("nor for another curriculum's exercise of a shared character: it counts, at server time", async () => {
    const userId = await newUser();
    const clientDeviceId = randomUUID();
    await recordLessonDownload(
      prisma,
      { userId, clientDeviceId, lessonId: lessonA, contentVersion: 1 },
      new Date(Date.now() - 10 * DAY),
    );
    const y = await freehandOf(lessonY2); // 山, reached through lesson A
    const before = Date.now();
    await processSyncBatch(prisma, userId, {
      deviceId: clientDeviceId,
      events: [
        syncAttempt(
          writeAttempt(y.id, y.hanzi, { occurredAt: new Date(Date.now() - 5 * DAY).toISOString() }),
        ),
      ],
    });
    const stored = await latestAttempt(userId);
    expect(stored.countsForProgress).toBe(true);
    expect(stored.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("another learner can't borrow a device's download window", async () => {
    const owner = await newUser();
    const clientDeviceId = randomUUID();
    await recordLessonDownload(
      prisma,
      { userId: owner, clientDeviceId, lessonId: lessonA, contentVersion: 1 },
      new Date(Date.now() - 10 * DAY),
    );
    const other = await newUser();
    const a = await freehandOf(lessonA);
    const before = Date.now();
    await processSyncBatch(prisma, other, {
      deviceId: clientDeviceId,
      events: [
        syncAttempt(
          writeAttempt(a.id, a.hanzi, { occurredAt: new Date(Date.now() - 5 * DAY).toISOString() }),
        ),
      ],
    });
    expect((await latestAttempt(other)).occurredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("a download record never grants eligibility: even a forged one for a locked lesson stays a preview", async () => {
    const userId = await newUser();
    // The download route refuses locked lessons; insert the row directly to prove independence.
    const dev = await deviceWithDownload(userId, lessonB, new Date(Date.now() - 10 * DAY));
    const b = await freehandOf(lessonB);
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId: dev.clientId,
      events: [
        syncAttempt(
          writeAttempt(b.id, b.hanzi, { occurredAt: new Date(Date.now() - 5 * DAY).toISOString() }),
        ),
      ],
    });
    expect(results[0]).toMatchObject({ status: "processed", result: { xpAwarded: 0 } });
    expect((await latestAttempt(userId)).countsForProgress).toBe(false);
    expect(await sideEffects(userId)).toEqual(NONE);
  });

  it("session-less offline attempts can't claim another lesson or another learner's session", async () => {
    const userId = await newUser();
    const dev = await deviceWithDownload(userId, lessonA, new Date(Date.now() - 10 * DAY));
    const b = await freehandOf(lessonB);
    const owner = await newUser();
    const foreign = await startLessonSession(prisma, owner, lessonA);
    const a = await freehandOf(lessonA);
    const { results } = await processSyncBatch(prisma, userId, {
      deviceId: dev.clientId,
      events: [
        syncAttempt(writeAttempt(b.id, b.hanzi, { lessonId: lessonA })),
        syncAttempt(writeAttempt(a.id, a.hanzi, { sessionId: foreign.id })),
      ],
    });
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(await prisma.exerciseAttempt.count({ where: { userId } })).toBe(0);
  });

  it("RESIDUAL (documented): inside a real download window the device clock is trusted", async () => {
    // D-085 keeps offline device time from the first download onwards. A learner who downloaded
    // a lesson 12 days ago can still submit chosen, spaced times within those 12 days. This test
    // pins that limit so a future fix changes it on purpose (docs/m18/M18-security-review.md).
    const userId = await newUser();
    const ex = await freehandOf(lessonA);
    const downloaded = Date.now() - 12 * DAY;
    const dev = await deviceWithDownload(userId, lessonA, new Date(downloaded));
    let at = Date.now() - 11 * DAY;
    for (let i = 0; i < 4 && at < Date.now(); i += 1) {
      await processSyncBatch(prisma, userId, {
        deviceId: dev.clientId,
        events: [
          syncAttempt(writeAttempt(ex.id, ex.hanzi, { occurredAt: new Date(at).toISOString() })),
        ],
      });
      const schedule = await prisma.reviewSchedule.findUniqueOrThrow({
        where: { userId_characterId: { userId, characterId: ex.characterId } },
      });
      at = schedule.dueAt.getTime() + MINUTE;
    }
    const days = await prisma.dailyActivity.count({ where: { userId } });
    expect(days).toBeGreaterThan(1); // backdated days inside the window are accepted
    // …but never earlier than the download, whatever the device claims.
    const earliest = await prisma.exerciseAttempt.findFirstOrThrow({
      where: { userId },
      orderBy: { occurredAt: "asc" },
    });
    expect(earliest.occurredAt.getTime()).toBeGreaterThanOrEqual(downloaded - 5 * MINUTE);
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
