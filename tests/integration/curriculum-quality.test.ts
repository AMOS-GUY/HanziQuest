/** M7: protected reviewed content, import preview, atomic import audit, levels and placement. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { previewCurriculumImport } from "@/features/curriculum/import-preview";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { getLessonState } from "@/features/progression/lesson-states";
import {
  generateQuestions,
  getPlacementLevel,
  loadLevelUnits,
  placementRetakeAt,
  startPlacement,
  submitPlacement,
} from "@/features/assessment/placement";
import { recordAudit } from "@/lib/audit";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;

function file(opts: {
  slug: string;
  level?: number;
  meaning?: string;
  lessons?: { slug: string; words: { simplified: string; pinyin: string; meaning: string }[] }[];
}) {
  const result = validateCurriculumContent(
    {
      curriculum: {
        slug: opts.slug,
        name: `CQ ${opts.slug}`,
        framework: "CUSTOM",
        version: opts.slug,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: opts.level ?? 1, name: `L${opts.level ?? 1}` },
      characters: {
        龙: { pinyin: "lóng", meaning: opts.meaning ?? "dragon" },
        鱼: { pinyin: "yú", meaning: "fish" },
      },
      units: [
        {
          slug: "u1",
          title: "U1",
          lessons: opts.lessons ?? [
            { slug: "l1", words: [{ simplified: "龙", pinyin: "lóng", meaning: "dragon" }] },
            { slug: "l2", words: [{ simplified: "鱼", pinyin: "yú", meaning: "fish" }] },
          ],
        },
      ].map((u) => ({ ...u, lessons: u.lessons.map((l) => ({ ...l, title: l.slug })) })),
    },
    loadStrokeData,
  );
  expect(result.ok, JSON.stringify(result.issues)).toBe(true);
  return result.content!;
}

const importFile = (content: ReturnType<typeof file>) =>
  importCurriculumContent(prisma, content, {
    publishNewLessons: true,
    lookupStrokes: loadStrokeData,
  });

async function newUser() {
  const r = await registerUser(prisma, {
    displayName: "CQ",
    email: uniqueEmail("cq"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

beforeAll(async () => {
  await ensureRoles(prisma);
  // Shared characters persist between runs: start from a known, provisional state.
  await prisma.character.updateMany({
    where: { hanzi: { in: ["龙", "鱼"] } },
    data: { verification: "PROVISIONAL", meaning: "dragon" },
  });
  await prisma.character.updateMany({ where: { hanzi: "鱼" }, data: { meaning: "fish" } });
  await prisma.vocabulary.updateMany({
    where: { simplified: "龙", pinyin: "lóng" },
    data: { verification: "PROVISIONAL", meaning: "dragon" },
  });
});

afterAll(async () => {
  await prisma.character.updateMany({
    where: { hanzi: { in: ["龙", "鱼"] } },
    data: { verification: "PROVISIONAL" },
  });
  await prisma.vocabulary.updateMany({
    where: { simplified: "龙", pinyin: "lóng" },
    data: { verification: "PROVISIONAL" },
  });
  await prisma.$disconnect();
});

describe("D-038: reviewed shared content is protected from less verified imports", () => {
  it("keeps a verified gloss against a provisional import, and reports it", async () => {
    await importFile(file({ slug: `cq-a-${RUN}` }));
    await prisma.character.update({
      where: { hanzi: "龙" },
      data: { verification: "VERIFIED", meaning: "dragon" },
    });

    const incoming = file({ slug: `cq-b-${RUN}`, meaning: "loong (wrong gloss)" });
    const preview = await previewCurriculumImport(prisma, incoming);
    const change = preview.characters.changed.find((c) => c.key === "龙");
    expect(change).toMatchObject({ protected: true });
    expect(change!.changes).toEqual([
      { field: "meaning", from: "dragon", to: "loong (wrong gloss)" },
    ]);
    expect(change!.sharedWith).toContain(`CQ cq-a-${RUN}`);

    const summary = await importFile(incoming);
    expect(summary.protectedKept).toContain("龙");
    const row = await prisma.character.findUniqueOrThrow({ where: { hanzi: "龙" } });
    expect(row).toMatchObject({ meaning: "dragon", verification: "VERIFIED" });
    // Generated exercise prompts use the kept gloss, not the file's.
    const exercise = await prisma.exercise.findFirstOrThrow({
      where: {
        curriculum: { slug: `cq-b-${RUN}` },
        type: "MEANING_TO_HANZI",
        expectedAnswer: "龙",
      },
    });
    expect(JSON.stringify(exercise.prompt)).not.toContain("loong");
  });

  it("lets a provisional import update a provisional record, and keeps a revision", async () => {
    // Content files can only be PROVISIONAL (D-074), so only provisional records take updates.
    await prisma.character.update({
      where: { hanzi: "龙" },
      data: { verification: "PROVISIONAL" },
    });
    const summary = await importFile(
      file({ slug: `cq-c-${RUN}`, meaning: "dragon; imperial symbol" }),
    );
    expect(summary.protectedKept).not.toContain("龙");
    // The previous values are kept as a content revision, attributed to the import.
    expect(summary.revised).toContain("龙");
    const dragon = await prisma.character.findUniqueOrThrow({ where: { hanzi: "龙" } });
    const revision = await prisma.contentRevision.findFirstOrThrow({
      where: { entityType: "Character", entityId: dragon.id },
      orderBy: { revision: "desc" },
    });
    expect(revision.data).toMatchObject({ meaning: "dragon", changedBy: `import:cq-c-${RUN}` });
    expect((await prisma.character.findUniqueOrThrow({ where: { hanzi: "龙" } })).meaning).toBe(
      "dragon; imperial symbol",
    );
    await prisma.character.update({
      where: { hanzi: "龙" },
      data: { verification: "PROVISIONAL", meaning: "dragon" },
    });
  });
});

describe("import preview", () => {
  it("reports new and changed lessons without writing anything", async () => {
    const slug = `cq-p-${RUN}`;
    const first = file({ slug });
    const before = await previewCurriculumImport(prisma, first);
    expect(before.curriculum.exists).toBe(false);
    expect(before.lessons.added).toEqual(["u1/l1", "u1/l2"]);
    expect(await prisma.curriculum.count({ where: { slug } })).toBe(0);

    await importFile(first);
    const same = await previewCurriculumImport(prisma, first);
    expect(same.lessons).toMatchObject({ added: [], wordListChanged: [], unchanged: 2 });

    const edited = file({
      slug,
      lessons: [
        {
          slug: "l1",
          words: [
            { simplified: "龙", pinyin: "lóng", meaning: "dragon" },
            { simplified: "鱼", pinyin: "yú", meaning: "fish" },
          ],
        },
      ],
    });
    const after = await previewCurriculumImport(prisma, edited);
    expect(after.lessons.wordListChanged).toEqual(["u1/l1"]);
    expect(after.lessons.notInFile).toEqual(["u1/l2"]);
  });
});

describe("D-M7-02: the import audit entry is part of the import transaction", () => {
  it("rolls the whole import back when the audit write fails", async () => {
    const slug = `cq-x-${RUN}`;
    await expect(
      importCurriculumContent(prisma, file({ slug }), {
        publishNewLessons: true,
        lookupStrokes: loadStrokeData,
        onImported: async () => {
          throw new Error("audit store unavailable");
        },
      }),
    ).rejects.toThrow("audit store unavailable");
    expect(await prisma.curriculum.count({ where: { slug } })).toBe(0);

    const actor = await newUser();
    const summary = await importCurriculumContent(prisma, file({ slug }), {
      publishNewLessons: true,
      lookupStrokes: loadStrokeData,
      onImported: (tx, s) =>
        recordAudit(tx, {
          actorId: actor,
          action: "content.import",
          entityType: "Curriculum",
          entityId: s.curriculumId,
        }),
    });
    expect(
      await prisma.auditLog.count({
        where: { action: "content.import", entityId: summary.curriculumId },
      }),
    ).toBe(1);
  });
});

describe("D-039: levels unlock in order", () => {
  it("keeps level 2 locked until the last lesson of level 1 is done", async () => {
    const slug = `cq-lv-${RUN}`;
    await importFile(file({ slug, level: 1 }));
    await importFile(
      file({
        slug,
        level: 2,
        lessons: [{ slug: "l1", words: [{ simplified: "鱼", pinyin: "yú", meaning: "fish" }] }],
      }),
    );
    const lessons = await prisma.lesson.findMany({
      where: { unit: { level: { curriculum: { slug } } } },
      include: { unit: { include: { level: true } } },
      orderBy: [{ unit: { level: { level: "asc" } } }, { position: "asc" }],
    });
    const [l1a, l1b, l2a] = lessons;
    expect(l2a!.unit.level.level).toBe(2);

    const learner = await newUser();
    expect(await getLessonState(prisma, learner, l1a!.id)).toBe("AVAILABLE");
    expect(await getLessonState(prisma, learner, l2a!.id)).toBe("LOCKED");

    await prisma.lessonProgress.create({
      data: { userId: learner, lessonId: l1a!.id, status: "COMPLETED" },
    });
    expect(await getLessonState(prisma, learner, l2a!.id)).toBe("LOCKED");
    await prisma.lessonProgress.create({
      data: { userId: learner, lessonId: l1b!.id, status: "TESTED_OUT" },
    });
    expect(await getLessonState(prisma, learner, l2a!.id)).toBe("AVAILABLE");
  });
});

describe("D-040: placement can't be retaken immediately", () => {
  it("blocks a new check for 24 hours after one is completed", async () => {
    const learner = await newUser();
    expect(await placementRetakeAt(prisma, learner)).toBeNull();
    const { assessmentId } = await startPlacement(prisma, learner);
    const level = (await getPlacementLevel(prisma))!;
    const questions = generateQuestions(assessmentId, await loadLevelUnits(prisma, level.id));
    await submitPlacement(
      prisma,
      learner,
      assessmentId,
      questions.map(() => null),
    );
    const retake = await placementRetakeAt(prisma, learner);
    expect(retake).not.toBeNull();
    expect(retake!.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    await expect(startPlacement(prisma, learner)).rejects.toMatchObject({ code: "conflict" });
    // A day later it's allowed again.
    expect(
      await placementRetakeAt(prisma, learner, new Date(Date.now() + 25 * 3_600_000)),
    ).toBeNull();
  });
});
