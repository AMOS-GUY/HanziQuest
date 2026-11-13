import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import {
  DomainError,
  setLessonStatus,
  setUserRole,
  type Actor,
} from "@/features/administration/services";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import type { StrokeData } from "@/features/curriculum/stroke-data";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const strokes: StrokeData = {
  strokes: ["M 0 0", "M 1 1"],
  medians: [
    [
      [0, 0],
      [1, 1],
    ],
    [
      [1, 1],
      [2, 2],
    ],
  ],
};

async function newUser(prefix: string) {
  const result = await registerUser(prisma, {
    displayName: prefix,
    email: uniqueEmail(prefix),
    password: "password-1234",
  });
  if (!result.ok) throw new Error("setup failed");
  return result.userId;
}

async function grantDirect(userId: string, key: "SUPER_ADMIN" | "CURRICULUM_EDITOR") {
  const role = await prisma.role.findUniqueOrThrow({ where: { key } });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
}

function content(words: { simplified: string; pinyin: string; meaning: string }[]) {
  return {
    curriculum: {
      slug: `integration-${RUN}`,
      name: "Integration",
      framework: "CUSTOM",
      version: `it-${RUN}`,
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
    units: [{ slug: "u1", title: "U1", lessons: [{ slug: "l1", title: "L1", words }] }],
  };
}

let superAdmin: Actor;
let lessonId: string;

beforeAll(async () => {
  await ensureRoles(prisma);
  const id = await newUser("super");
  await grantDirect(id, "SUPER_ADMIN");
  superAdmin = { id, roles: ["SUPER_ADMIN", "LEARNER"] };

  const valid = validateCurriculumContent(
    content([
      { simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello" },
      { simplified: "我", pinyin: "wǒ", meaning: "I" },
    ]),
    () => strokes,
  );
  expect(valid.ok).toBe(true);
  const summary = await importCurriculumContent(prisma, valid.content!, {
    publishNewLessons: true,
    lookupStrokes: () => strokes,
  });
  const lesson = await prisma.lesson.findFirstOrThrow({
    where: { slug: "l1", unit: { level: { curriculumId: summary.curriculumId } } },
  });
  lessonId = lesson.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("curriculum import", () => {
  it("creates characters, strokes, vocabulary links and exercises", async () => {
    const lesson = await prisma.lesson.findUniqueOrThrow({
      where: { id: lessonId },
      include: { vocabulary: true, characters: true, exercises: { include: { exercise: true } } },
    });
    expect(lesson.status).toBe("PUBLISHED");
    expect(lesson.vocabulary).toHaveLength(2);
    expect(lesson.characters).toHaveLength(3);
    const types = lesson.exercises.map((e) => e.exercise.type);
    // 3 guided + 2 words × 2 recall types + 3 freehand
    expect(types.filter((t) => t === "GUIDED_STROKE")).toHaveLength(3);
    expect(types.filter((t) => t === "MEANING_TO_HANZI")).toHaveLength(2);
    expect(types.filter((t) => t === "PINYIN_TO_HANZI")).toHaveLength(2);
    expect(types.filter((t) => t === "FREEHAND_WRITING")).toHaveLength(3);

    const nihao = await prisma.vocabulary.findFirstOrThrow({
      where: { simplified: "你好" },
      include: { characters: { orderBy: { position: "asc" }, include: { character: true } } },
    });
    expect(nihao.characters.map((c) => c.character.hanzi)).toEqual(["你", "好"]);
    expect(await prisma.characterStroke.count({ where: { character: { hanzi: "你" } } })).toBe(2);
  });

  it("is idempotent and only bumps contentVersion when the word list changes", async () => {
    const lookup = () => strokes;
    const same = validateCurriculumContent(
      content([
        { simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello" },
        { simplified: "我", pinyin: "wǒ", meaning: "I" },
      ]),
      lookup,
    ).content!;
    const exercisesBefore = await prisma.exercise.count();
    await importCurriculumContent(prisma, same, { publishNewLessons: true, lookupStrokes: lookup });
    expect(await prisma.exercise.count()).toBe(exercisesBefore);
    expect(
      (await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } })).contentVersion,
    ).toBe(1);

    const changed = validateCurriculumContent(
      content([{ simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello" }]),
      lookup,
    ).content!;
    await importCurriculumContent(prisma, changed, {
      publishNewLessons: true,
      lookupStrokes: lookup,
    });
    const lesson = await prisma.lesson.findUniqueOrThrow({
      where: { id: lessonId },
      include: { vocabulary: true },
    });
    expect(lesson.contentVersion).toBe(2);
    expect(lesson.vocabulary).toHaveLength(1);
    // Non-destructive: the removed word still exists.
    expect(await prisma.vocabulary.count({ where: { simplified: "我" } })).toBe(1);
  });
});

describe("setLessonStatus", () => {
  it("unpublishes with a content revision and audit entry", async () => {
    await setLessonStatus(prisma, superAdmin, lessonId, "DRAFT");
    expect((await prisma.lesson.findUniqueOrThrow({ where: { id: lessonId } })).status).toBe(
      "DRAFT",
    );
    const revision = await prisma.contentRevision.findFirst({
      where: { entityId: lessonId },
      orderBy: { revision: "desc" },
    });
    expect(revision?.data).toMatchObject({ status: "PUBLISHED" });
    expect(
      await prisma.auditLog.count({ where: { entityId: lessonId, action: "lesson.unpublish" } }),
    ).toBe(1);

    await setLessonStatus(prisma, superAdmin, lessonId, "PUBLISHED");
    expect(await prisma.contentRevision.count({ where: { entityId: lessonId } })).toBe(2);
  });

  it("does nothing when the status is unchanged", async () => {
    const before = await prisma.auditLog.count();
    await setLessonStatus(prisma, superAdmin, lessonId, "PUBLISHED");
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it("throws not_found for unknown lessons", async () => {
    await expect(setLessonStatus(prisma, superAdmin, "missing", "DRAFT")).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});

describe("setUserRole", () => {
  it("grants and revokes roles with audit entries", async () => {
    const target = await newUser("editor");
    await setUserRole(prisma, superAdmin, target, "CURRICULUM_EDITOR", true);
    const roles = await prisma.userRole.findMany({
      where: { userId: target },
      include: { role: true },
    });
    expect(roles.map((r) => r.role.key).sort()).toEqual(["CURRICULUM_EDITOR", "LEARNER"]);
    expect(roles.find((r) => r.role.key === "CURRICULUM_EDITOR")?.assignedById).toBe(superAdmin.id);

    await setUserRole(prisma, superAdmin, target, "CURRICULUM_EDITOR", false);
    expect(await prisma.userRole.count({ where: { userId: target } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: target, action: { startsWith: "user.role." } },
      }),
    ).toBe(2);
  });

  it("refuses to remove the LEARNER role", async () => {
    const target = await newUser("learner");
    await expect(setUserRole(prisma, superAdmin, target, "LEARNER", false)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("stops non-super-admins from granting SUPER_ADMIN", async () => {
    const target = await newUser("climber");
    const editor: Actor = { id: target, roles: ["CURRICULUM_EDITOR", "LEARNER"] };
    await expect(setUserRole(prisma, editor, target, "SUPER_ADMIN", true)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("stops a super admin from removing their own SUPER_ADMIN role", async () => {
    await expect(
      setUserRole(prisma, superAdmin, superAdmin.id, "SUPER_ADMIN", false),
    ).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("lets one super admin demote another, but never themselves", async () => {
    const other = await newUser("other-super");
    await grantDirect(other, "SUPER_ADMIN");
    const otherActor: Actor = { id: other, roles: ["SUPER_ADMIN"] };
    await setUserRole(prisma, otherActor, superAdmin.id, "SUPER_ADMIN", false);
    await expect(
      setUserRole(prisma, otherActor, other, "SUPER_ADMIN", false),
    ).rejects.toMatchObject({ code: "conflict" });
    const superRole = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    expect(await prisma.userRole.count({ where: { userId: other, roleId: superRole.id } })).toBe(1);
    expect(
      await prisma.userRole.count({ where: { userId: superAdmin.id, roleId: superRole.id } }),
    ).toBe(0);
  });
});

describe("role rows (M14-b)", () => {
  it("granting a role whose row is missing creates it from its definition", async () => {
    const admin = await newUser("roleadmin");
    await grantDirect(admin, "SUPER_ADMIN");
    const target = await newUser("rolereviewer");
    await prisma.userRole.deleteMany({ where: { role: { key: "CONTENT_REVIEWER" } } });
    await prisma.role.deleteMany({ where: { key: "CONTENT_REVIEWER" } });
    const actor: Actor = { id: admin, roles: ["SUPER_ADMIN"] };
    await setUserRole(prisma, actor, target, "CONTENT_REVIEWER", true);
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "CONTENT_REVIEWER" } });
    expect(role.name).toBe("Content reviewer");
    expect(await prisma.userRole.count({ where: { userId: target, roleId: role.id } })).toBe(1);
    // Revoking never creates a row.
    await setUserRole(prisma, actor, target, "CONTENT_REVIEWER", false);
    expect(await prisma.userRole.count({ where: { userId: target, roleId: role.id } })).toBe(0);
  });
});
