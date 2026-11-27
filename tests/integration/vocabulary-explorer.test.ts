import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { submitAttempt } from "@/features/exercises/attempts";
import { completeLessonSession, startLessonSession } from "@/features/learning/sessions";
import { getVocabularyExplorer } from "@/features/learning/vocabulary-explorer";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

/**
 * The Vocabulary Explorer lists words from lessons the learner has reached only. Locked
 * lessons' words must not come back through the list, search, the lesson filter or unpublished
 * content. Other test files publish curricula into the same database, so assertions are scoped
 * to this file's own lessons and words.
 */
const prisma = testPrisma();
const RUN = `${Date.now()}`;

let curriculumId: string;
let lesson1: string;
let lesson2: string;
let lesson3: string;
let mineWordIds: Set<string>;

function ink(hanzi: string, seed = 1) {
  return toInk(fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians).medians, { seed });
}

async function newUser() {
  const r = await registerUser(prisma, {
    displayName: "V",
    email: uniqueEmail("vocab"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

/** Completes a lesson through the real session and attempt services (no state shortcuts). */
async function completeLesson(userId: string, lessonId: string) {
  const session = await startLessonSession(prisma, userId, lessonId);
  const list = await prisma.lessonExercise.findMany({
    where: { lessonId },
    orderBy: { position: "asc" },
    include: { exercise: true },
  });
  for (const { exercise } of list) {
    const chars = (exercise.evaluationConfig as { characters: string[] }).characters;
    await submitAttempt(prisma, userId, {
      clientEventId: randomUUID(),
      exerciseId: exercise.id,
      sessionId: session.id,
      occurredAt: new Date().toISOString(),
      ...(exercise.type === "GUIDED_STROKE"
        ? { kind: "guided", mistakes: 0 }
        : { kind: "writing", drawings: chars.map((c, i) => ink(c, i + 5)) }),
    });
  }
  await completeLessonSession(prisma, userId, session.id);
}

/** The explorer's output restricted to this file's curriculum. */
async function mine(userId: string, filter = {}) {
  const e = await getVocabularyExplorer(prisma, userId, filter);
  const own = new Set([lesson1, lesson2, lesson3]);
  return {
    ...e,
    lessons: e.lessons.filter((l) => own.has(l.id)),
    words: e.words.filter((w) => own.has(w.lessonId)),
  };
}

beforeAll(async () => {
  await ensureRoles(prisma);
  // The test database is never wiped (global-setup.ts) and vocabulary rows are shared across
  // curricula, so earlier runs of this file would list the same words first. Archive them.
  await prisma.curriculum.updateMany({
    where: { slug: { startsWith: "vocab-explorer-" } },
    data: { status: "ARCHIVED" },
  });
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `vocab-explorer-${RUN}`,
        name: "Vocab Explorer IT",
        framework: "CUSTOM",
        version: `vocab-explorer-${RUN}`,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: {
        猫: { pinyin: "māo", meaning: "cat" },
        狗: { pinyin: "gǒu", meaning: "dog" },
        鸟: { pinyin: "niǎo", meaning: "bird" },
      },
      units: [
        {
          slug: "u1",
          title: "Greetings",
          lessons: [
            {
              slug: "l1",
              title: "Hello",
              words: [{ simplified: "猫", pinyin: "māo", meaning: "cat" }],
            },
            {
              slug: "l2",
              title: "Me",
              words: [{ simplified: "狗", pinyin: "gǒu", meaning: "dog" }],
            },
            {
              slug: "l3",
              title: "Thanks",
              words: [{ simplified: "鸟", pinyin: "niǎo", meaning: "bird" }],
            },
          ],
        },
      ],
    },
    loadStrokeData,
  );
  expect(content.issues.filter((i) => i.severity === "error")).toEqual([]);
  expect(content.ok).toBe(true);
  const summary = await importCurriculumContent(prisma, content.content!, {
    publishNewLessons: true,
    lookupStrokes: loadStrokeData,
  });
  curriculumId = summary.curriculumId;
  const lessons = await prisma.lesson.findMany({
    where: { unit: { level: { curriculumId } } },
    orderBy: { position: "asc" },
    include: { vocabulary: true },
  });
  [lesson1, lesson2, lesson3] = lessons.map((l) => l.id) as [string, string, string];
  // A content file can't list a word twice, but a shared word can be linked to more than one
  // lesson (vocabulary is shared across curricula). Link 猫 into lesson 2 as well.
  await prisma.lessonVocabulary.create({
    data: { lessonId: lesson2, vocabularyId: lessons[0]!.vocabulary[0]!.vocabularyId, position: 9 },
  });
  mineWordIds = new Set(lessons.flatMap((l) => l.vocabulary.map((v) => v.vocabularyId)));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getVocabularyExplorer", () => {
  it("shows a new learner only the first lesson's words", async () => {
    const userId = await newUser();
    const e = await mine(userId);
    expect(e.lessons.map((l) => l.id)).toEqual([lesson1]);
    expect(e.words.map((w) => w.simplified)).toEqual(["猫"]);
    expect(e.words[0]).toMatchObject({ pinyin: "māo", meaning: "cat", lessonId: lesson1 });
    expect(e.words[0]!.characters).toEqual(["猫"]);
    expect(e.words[0]!.provisional).toBe(true);
    expect(e.moreToUnlock).toBe(true);
  });

  it("never returns locked words through search or the lesson filter", async () => {
    const userId = await newUser();
    for (const q of ["鸟", "niao", "bird"]) expect((await mine(userId, { q })).words).toEqual([]);
    const byLocked = await getVocabularyExplorer(prisma, userId, { lessonId: lesson3 });
    expect(byLocked.words).toEqual([]);
    expect(byLocked.lessons.some((l) => l.id === lesson3)).toBe(false);
    const all = await getVocabularyExplorer(prisma, userId);
    expect(all.words.some((w) => mineWordIds.has(w.id) && w.simplified === "鸟")).toBe(false);
  });

  it("adds the next lesson after one is completed and lists shared words once", async () => {
    const userId = await newUser();
    await completeLesson(userId, lesson1);
    const e = await mine(userId);
    expect(e.lessons.map((l) => [l.id, l.state])).toEqual([
      [lesson1, "COMPLETED"],
      [lesson2, "AVAILABLE"],
    ]);
    // 猫 is linked to both lessons: listed once, under the first.
    expect(e.words.map((w) => [w.simplified, w.lessonId])).toEqual([
      ["猫", lesson1],
      ["狗", lesson2],
    ]);
    expect((await mine(userId, { q: "gou" })).words.map((w) => w.simplified)).toEqual(["狗"]);
    expect(e.words[0]!.lessonIds).toEqual([lesson1, lesson2]);
    // The lesson 2 filter shows everything lesson 2 teaches, the shared word included, under it.
    const l2 = await mine(userId, { lessonId: lesson2 });
    expect(l2.words.map((w) => [w.simplified, w.lessonId])).toEqual([
      ["猫", lesson2],
      ["狗", lesson2],
    ]);
  });

  it("hides a reached lesson's words once it is unpublished", async () => {
    const userId = await newUser();
    await prisma.lesson.update({ where: { id: lesson1 }, data: { status: "DRAFT" } });
    try {
      const e = await mine(userId);
      // The unpublished lesson and anything attributed to it are gone. (The existing progression
      // rules then make lesson 2 the first lesson, so its words, 猫 included, are reachable.)
      expect(e.lessons.some((l) => l.id === lesson1)).toBe(false);
      expect(e.words.some((w) => w.lessonId === lesson1)).toBe(false);
      expect(e.words.map((w) => [w.simplified, w.lessonId])).toEqual([
        ["狗", lesson2],
        ["猫", lesson2],
      ]);
    } finally {
      await prisma.lesson.update({ where: { id: lesson1 }, data: { status: "PUBLISHED" } });
    }
  });

  it("hides everything in an unpublished curriculum", async () => {
    const userId = await newUser();
    await prisma.curriculum.update({ where: { id: curriculumId }, data: { status: "ARCHIVED" } });
    try {
      const e = await mine(userId);
      expect(e.lessons).toEqual([]);
      expect(e.words).toEqual([]);
    } finally {
      await prisma.curriculum.update({
        where: { id: curriculumId },
        data: { status: "PUBLISHED" },
      });
    }
  });

  it("is read-only: browsing writes no progress, sessions or schedules", async () => {
    const userId = await newUser();
    const counts = async () =>
      Promise.all([
        prisma.learningSession.count({ where: { userId } }),
        prisma.lessonProgress.count({ where: { userId } }),
        prisma.reviewSchedule.count({ where: { userId } }),
        prisma.characterMastery.count({ where: { userId } }),
      ]);
    const before = await counts();
    await getVocabularyExplorer(prisma, userId, { q: "hao" });
    expect(await counts()).toEqual(before);
  });
});
