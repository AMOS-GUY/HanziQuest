import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import * as admin from "@/features/administration/curriculum-admin";
import { setLessonStatus } from "@/features/administration/services";
import { completeLessonSession, startLessonSession } from "@/features/learning/sessions";
import { submitAttempt } from "@/features/exercises/attempts";
import type { Actor } from "@/features/administration/services";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
let actor: Actor;

const meta = { source: "integration test", licenseStatus: "ORIGINAL", verification: "PROVISIONAL" };

beforeAll(async () => {
  await ensureRoles(prisma);
  const r = await registerUser(prisma, {
    displayName: "Editor",
    email: uniqueEmail("editor"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  actor = { id: r.userId, roles: ["CURRICULUM_EDITOR"], ip: "127.0.0.1", userAgent: "vitest" };
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function ensureCharacter(hanzi: string, pinyin: string, meaning: string) {
  const existing = await prisma.character.findUnique({ where: { hanzi } });
  if (existing) return existing;
  return admin.createCharacter(prisma, actor, { hanzi, pinyin, meaning, ...meta });
}

async function ensureWord(simplified: string, pinyin: string, meaning: string) {
  const existing = await prisma.vocabulary.findUnique({
    where: { simplified_pinyin: { simplified, pinyin } },
  });
  if (existing) return existing;
  return admin.createVocabulary(prisma, actor, { simplified, pinyin, meaning, ...meta });
}

describe("curriculum editing", () => {
  it("builds a curriculum from scratch, with revisions and audit entries", async () => {
    const curriculum = await admin.createCurriculum(prisma, actor, {
      slug: `admin-${RUN}`,
      name: "Admin IT",
      framework: "CUSTOM",
      version: `admin-${RUN}`,
      ...meta,
    });
    await expect(
      admin.createCurriculum(prisma, actor, {
        slug: `admin-${RUN}`,
        name: "Dup",
        framework: "CUSTOM",
        version: `other-${RUN}`,
        ...meta,
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const level = await admin.createLevel(prisma, actor, {
      curriculumId: curriculum.id,
      level: "1",
      name: "L1",
    });
    const unit = await admin.createUnit(prisma, actor, {
      levelId: level.id,
      slug: "u1",
      title: "U1",
    });
    const lesson = await admin.createLesson(prisma, actor, {
      unitId: unit.id,
      slug: "l1",
      title: "First",
    });
    expect(lesson.status).toBe("DRAFT");
    const lesson2 = await admin.createLesson(prisma, actor, {
      unitId: unit.id,
      slug: "l2",
      title: "Second",
    });
    expect(lesson2.position).toBe(2);

    await ensureCharacter("人", "rén", "person");
    await ensureCharacter("口", "kǒu", "mouth");
    await ensureWord("人", "rén", "person");
    await ensureWord("人口", "rénkǒu", "population");

    await expect(
      admin.setLessonWords(prisma, actor, lesson.id, { words: "不存在 | bù cún zài" }),
    ).rejects.toMatchObject({ code: "conflict" });

    const built = await admin.setLessonWords(prisma, actor, lesson.id, {
      words: "人 | rén\n人口 | rénkǒu",
    });
    expect(built.characters).toEqual(["人", "口"]);
    // 2 guided + 2×2 word recall + 2 free writing
    expect(built.generatedExercises).toBe(8);

    // The second lesson reusing 人 must not treat it as new.
    const second = await admin.setLessonWords(prisma, actor, lesson2.id, { words: "人" });
    expect(second.generatedExercises).toBe(2);
    const chars = await prisma.lessonCharacter.findMany({ where: { lessonId: lesson2.id } });
    expect(chars.every((c) => !c.isNew)).toBe(true);

    const refreshed = await prisma.lesson.findUniqueOrThrow({ where: { id: lesson.id } });
    expect(refreshed.contentVersion).toBeGreaterThan(lesson.contentVersion);
    const revisions = await prisma.contentRevision.count({
      where: { entityType: "LessonWords", entityId: lesson.id },
    });
    expect(revisions).toBe(1);
    const audits = await prisma.auditLog.findMany({
      where: { actorId: actor.id, entityId: lesson.id },
      select: { action: true },
    });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["lesson.create", "lesson.words.update"]),
    );
  });

  it("keeps hand-written exercises across word changes and protects generated ones", async () => {
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { slug: "l1", unit: { level: { curriculum: { slug: `admin-${RUN}` } } } },
    });
    const custom = await admin.createCustomExercise(prisma, actor, {
      lessonId: lesson.id,
      type: "MEANING_TO_HANZI",
      answer: "人口",
      promptText: "how many people live somewhere",
      difficulty: "3",
    });
    await expect(
      admin.createCustomExercise(prisma, actor, {
        lessonId: lesson.id,
        type: "FREEHAND_WRITING",
        answer: "人口",
        promptText: "two characters",
        difficulty: "1",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    await admin.setLessonWords(prisma, actor, lesson.id, { words: "人口 | rénkǒu\n人 | rén" });
    const links = await prisma.lessonExercise.findMany({
      where: { lessonId: lesson.id },
      orderBy: { position: "asc" },
    });
    expect(links.at(-1)!.exerciseId).toBe(custom.id);

    const generated = links[0]!.exerciseId;
    await expect(
      admin.removeCustomExercise(prisma, actor, lesson.id, generated),
    ).rejects.toMatchObject({ code: "conflict" });
    await admin.removeCustomExercise(prisma, actor, lesson.id, custom.id);
    expect(
      await prisma.lessonExercise.count({ where: { lessonId: lesson.id, exerciseId: custom.id } }),
    ).toBe(0);
  });

  it("propagates edits to prompts and validates pinyin", async () => {
    const word = await prisma.vocabulary.findUniqueOrThrow({
      where: { simplified_pinyin: { simplified: "人口", pinyin: "rénkǒu" } },
    });
    await admin.updateVocabulary(prisma, actor, word.id, {
      ...meta,
      meaning: `population ${RUN}`,
    });
    const ex = await prisma.exercise.findFirstOrThrow({
      where: { vocabularyId: word.id, type: "MEANING_TO_HANZI", key: { startsWith: "word:" } },
    });
    expect((ex.prompt as { meaning: string }).meaning).toBe(`population ${RUN}`);

    const pinyinEx = await prisma.exercise.findFirstOrThrow({
      where: { vocabularyId: word.id, type: "PINYIN_TO_HANZI" },
    });
    await expect(
      admin.updateExercise(prisma, actor, pinyinEx.id, {
        promptText: "ren2 kou3",
        difficulty: "2",
        status: "PUBLISHED",
      }),
    ).rejects.toThrow();
    await expect(
      admin.createVocabulary(prisma, actor, {
        simplified: "龘",
        pinyin: "dá",
        meaning: "x",
        ...meta,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("only requires published exercises to complete a lesson", async () => {
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { slug: "l1", unit: { level: { curriculum: { slug: `admin-${RUN}` } } } },
      include: { exercises: { include: { exercise: true }, orderBy: { position: "asc" } } },
    });
    await setLessonStatus(prisma, actor, lesson.id, "PUBLISHED");
    const hidden = lesson.exercises.find((e) => e.exercise.type === "PINYIN_TO_HANZI")!;
    await admin.updateExercise(prisma, actor, hidden.exerciseId, {
      promptText: (hidden.exercise.prompt as { pinyin: string }).pinyin,
      difficulty: "2",
      status: "DRAFT",
    });

    const learner = await registerUser(prisma, {
      displayName: "L",
      email: uniqueEmail("admin-learner"),
      password: "password-1234",
    });
    if (!learner.ok) throw new Error("setup");
    const session = await startLessonSession(prisma, learner.userId, lesson.id);
    for (const { exercise } of lesson.exercises) {
      if (exercise.id === hidden.exerciseId) continue;
      const chars = (exercise.evaluationConfig as { characters: string[] }).characters;
      const strokes = (h: string) =>
        loadStrokeData(h)!.medians.map((m) => ({
          points: m.map(([x, y], i) => ({ x: x! / 1024, y: (900 - y!) / 1024, t: i * 10 })),
        }));
      await submitAttempt(prisma, learner.userId, {
        clientEventId: randomUUID(),
        exerciseId: exercise.id,
        sessionId: session.id,
        occurredAt: new Date().toISOString(),
        ...(exercise.type === "GUIDED_STROKE"
          ? { kind: "guided", mistakes: 0 }
          : { kind: "writing", drawings: chars.map(strokes) }),
      });
    }
    await expect(completeLessonSession(prisma, learner.userId, session.id)).resolves.toMatchObject({
      lessonId: lesson.id,
    });
  });
});
