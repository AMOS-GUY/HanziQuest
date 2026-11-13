/**
 * M14 provenance infrastructure: the importer stores source references and example provenance,
 * the admin records review metadata (role, never a name) and refuses VERIFIED with an unknown
 * licence. No real HSK data: fixtures only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { DomainError, type Actor } from "@/features/administration/services";
import { createCharacter, updateCharacter } from "@/features/administration/curriculum-admin";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { sourceRegister } from "@/features/curriculum/sources";
import type { StrokeData } from "@/features/curriculum/stroke-data";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const fake: StrokeData = {
  strokes: ["M 0 0"],
  medians: [
    [
      [0, 0],
      [1, 1],
    ],
  ],
};
let editor: Actor;

beforeAll(async () => {
  await ensureRoles(prisma);
  const r = await registerUser(prisma, {
    displayName: "editor",
    email: uniqueEmail("prov"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup failed");
  editor = { id: r.userId, roles: ["LEARNER", "CURRICULUM_EDITOR"] };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("import provenance", () => {
  it("stores curriculum, word and example source references", async () => {
    const raw = {
      curriculum: {
        slug: `prov-${RUN}`,
        name: "Provenance",
        framework: "CUSTOM",
        version: `prov-${RUN}`,
        source: "integration test",
        sourceRefs: ["hanziquest-authored"],
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: {
        们: { pinyin: "men", meaning: "plural suffix" },
        我: { pinyin: "wǒ", meaning: "I" },
      },
      units: [
        {
          slug: "u",
          title: "U",
          lessons: [
            {
              slug: "l",
              title: "L",
              words: [
                {
                  simplified: "我们",
                  pinyin: "wǒ men",
                  meaning: "we",
                  example: {
                    zh: "我们走吧。",
                    pinyin: "wǒmen zǒu ba.",
                    en: "Let's go.",
                    sourceRef: "hanziquest-authored",
                    verification: "PROVISIONAL",
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const v = validateCurriculumContent(raw, () => fake, sourceRegister());
    expect(v.ok).toBe(true);
    await importCurriculumContent(prisma, v.content!, {
      publishNewLessons: false,
      lookupStrokes: () => fake,
    });

    const curriculum = await prisma.curriculum.findUniqueOrThrow({
      where: { slug: `prov-${RUN}` },
    });
    expect(curriculum.sourceRefs).toEqual(["hanziquest-authored"]);
    const word = await prisma.vocabulary.findUniqueOrThrow({
      where: { simplified_pinyin: { simplified: "我们", pinyin: "wǒ men" } },
    });
    expect(word.sourceRefs).toContain("hanziquest-authored");
    expect(word.exampleSourceRef).toBe("hanziquest-authored");
    expect(word.exampleVerification).toBe("PROVISIONAL");
    const ch = await prisma.character.findUniqueOrThrow({ where: { hanzi: "们" } });
    expect(ch.sourceRefs).toContain("hanziquest-authored");
  });

  it("refuses to validate an unregistered source, so nothing is imported", () => {
    const v = validateCurriculumContent(
      {
        curriculum: {
          slug: `prov-bad-${RUN}`,
          name: "Bad",
          framework: "CUSTOM",
          version: `bad-${RUN}`,
          source: "x",
          sourceRefs: ["some-unregistered-list"],
          licenseStatus: "ORIGINAL",
          verification: "PROVISIONAL",
        },
        level: { level: 1, name: "L1" },
        characters: { 我: { pinyin: "wǒ", meaning: "I" } },
        units: [
          {
            slug: "u",
            title: "U",
            lessons: [
              { slug: "l", title: "L", words: [{ simplified: "我", pinyin: "wǒ", meaning: "I" }] },
            ],
          },
        ],
      },
      () => fake,
      sourceRegister(),
    );
    expect(v.ok).toBe(false);
  });
});

describe("review metadata in the admin", () => {
  const base = {
    pinyin: "lóng",
    pinyinAlternatives: "",
    meaning: "dragon (test)",
    source: "integration test",
    licenseStatus: "ORIGINAL",
    verification: "PROVISIONAL",
  };

  async function testCharacter() {
    // A character outside every curriculum and without stroke data: invisible to learners and
    // to handwriting identity checks.
    const hanzi = "龘";
    const existing = await prisma.character.findUnique({ where: { hanzi } });
    if (existing) return existing;
    return createCharacter(prisma, editor, { ...base, hanzi }, () => null);
  }

  it("verification can't change through the edit forms, for editors or super admins (M14-b)", async () => {
    const ch = await testCharacter();
    const superAdmin: Actor = { id: editor.id, roles: ["SUPER_ADMIN"] };
    // Resending the current value is fine.
    await updateCharacter(prisma, editor, ch.id, { ...base, verification: ch.verification });
    for (const actor of [editor, superAdmin])
      for (const v of ["REVIEWED", "VERIFIED"] as const) {
        const err = await updateCharacter(prisma, actor, ch.id, { ...base, verification: v }).catch(
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe("forbidden");
      }
    const row = await prisma.character.findUniqueOrThrow({ where: { id: ch.id } });
    expect(row.verification).toBe(ch.verification);
  });

  it("new content always starts PROVISIONAL", async () => {
    const err = await createCharacter(
      prisma,
      editor,
      { ...base, hanzi: "齉", verification: "REVIEWED" },
      () => null,
    ).catch((e: unknown) => e);
    expect((err as DomainError).code).toBe("forbidden");
    expect(await prisma.character.findUnique({ where: { hanzi: "齉" } })).toBeNull();
  });
});
