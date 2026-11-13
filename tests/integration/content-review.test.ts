/**
 * M14-b content review: authorization, self-review, exact-version (fingerprint) approvals,
 * invalidation after edits and imports, the source rules shared with imports, curriculum-level
 * approval, and preserved history.
 *
 * Uses characters no other test touches (鹿 龟 熊) and resets them first. Approvals need an
 * approved source; the repository register has none (both entries await the owner), so tests use
 * an in-memory copy with approved entries. The real register is used to show approval is refused.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { DomainError, type Actor } from "@/features/administration/services";
import { updateCharacter, updateVocabulary } from "@/features/administration/curriculum-admin";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { parseSourceRegister, sourceRegister } from "@/features/curriculum/sources";
import { curriculumItems } from "@/features/curriculum/review-fingerprint";
import {
  recordReview,
  reviewProgress,
  reviewQueue,
  type QueueItem,
} from "@/features/curriculum/review";
import type { StrokeData } from "@/features/curriculum/stroke-data";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
/** Audit entries persist across runs on these shared characters: count only this run's. */
const STARTED = new Date();
const CHARS = ["鹿", "龟", "熊"];
const fake: StrokeData = {
  strokes: ["M 0 0"],
  medians: [
    [
      [0, 0],
      [1, 1],
    ],
  ],
};

/** A copy of the repository register with every entry approved (tests only). */
const approved = parseSourceRegister({
  sources: sourceRegister().sources.map((s) => ({
    ...s,
    approval: { status: "APPROVED", approverRole: "SUPER_ADMIN", approvedOn: "2026-11-13" },
  })),
});
const pending = sourceRegister();

let reviewer: Actor;
let reviewer2: Actor;
let editor: Actor;
let editorReviewer: Actor;
let curriculumId: string;

async function user(prefix: string, roles: Actor["roles"]): Promise<Actor> {
  const r = await registerUser(prisma, {
    displayName: prefix,
    email: uniqueEmail(prefix),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return { id: r.userId, roles };
}

const content = (extraCharacterRefs: string[] = []) => ({
  curriculum: {
    slug: `review-${RUN}`,
    name: "Review IT",
    framework: "CUSTOM",
    version: `review-${RUN}`,
    source: "integration test",
    sourceRefs: ["hanziquest-authored"],
    licenseStatus: "ORIGINAL",
    verification: "PROVISIONAL",
  },
  level: { level: 1, name: "L1" },
  characters: {
    鹿: {
      pinyin: "lù",
      meaning: "deer",
      ...(extraCharacterRefs.length ? { sourceRefs: extraCharacterRefs } : {}),
    },
    龟: { pinyin: "guī", meaning: "tortoise" },
    熊: { pinyin: "xióng", meaning: "bear" },
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
            { simplified: "鹿", pinyin: "lù", meaning: "deer" },
            { simplified: "龟", pinyin: "guī", meaning: "tortoise" },
            { simplified: "熊", pinyin: "xióng", meaning: "bear" },
          ],
        },
      ],
    },
  ],
});

async function importIt(actor: Actor | null, extra: string[] = []) {
  const v = validateCurriculumContent(content(extra), () => fake);
  expect(v.ok).toBe(true);
  return importCurriculumContent(prisma, v.content!, {
    publishNewLessons: true,
    lookupStrokes: () => fake,
    authorId: actor?.id,
  });
}

async function item(type: QueueItem["entityType"], title: string, register = approved) {
  const q = await reviewQueue(prisma, curriculumId, register);
  return q.find((x) => x.entityType === type && x.title === title)!;
}

const code = async (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof DomainError ? e.code : String(e)),
  );

beforeAll(async () => {
  await ensureRoles(prisma);
  reviewer = await user("reviewer", ["CONTENT_REVIEWER"]);
  reviewer2 = await user("reviewer2", ["CONTENT_REVIEWER"]);
  editor = await user("editor", ["CURRICULUM_EDITOR"]);
  editorReviewer = await user("editrev", ["CURRICULUM_EDITOR", "CONTENT_REVIEWER"]);
  // Reset the fixture characters and words from earlier runs (test data only).
  const chars = await prisma.character.findMany({
    where: { hanzi: { in: CHARS } },
    select: { id: true },
  });
  const words = await prisma.vocabulary.findMany({
    where: { simplified: { in: CHARS } },
    select: { id: true },
  });
  await prisma.contentReview.deleteMany({
    where: { entityId: { in: [...chars, ...words].map((x) => x.id) } },
  });
  await prisma.character.updateMany({
    where: { hanzi: { in: CHARS } },
    data: { verification: "PROVISIONAL", reviewerRole: null, reviewedAt: null, sourceRefs: [] },
  });
  await prisma.vocabulary.updateMany({
    where: { simplified: { in: CHARS } },
    data: { verification: "PROVISIONAL", reviewerRole: null, reviewedAt: null, sourceRefs: [] },
  });
  // Imported by the system (no actor), so no reviewer authored it.
  curriculumId = (await importIt(null)).curriculumId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("who may review", () => {
  it("refuses curriculum editors (no curriculum:review)", async () => {
    const c = await item("CHARACTER", "鹿");
    expect(
      await code(
        recordReview(
          prisma,
          editor,
          {
            entityType: "CHARACTER",
            entityId: c.entityId,
            fingerprint: c.fingerprint,
            decision: "APPROVE_REVIEWED",
          },
          approved,
        ),
      ),
    ).toBe("forbidden");
  });

  it("refuses approval while the item's sources await the owner (the real register)", async () => {
    const c = await item("CHARACTER", "鹿", pending);
    expect(c.blockers.REVIEWED.map((b) => b.code)).toContain("source-not-approved");
    const err = await recordReview(
      prisma,
      reviewer,
      {
        entityType: "CHARACTER",
        entityId: c.entityId,
        fingerprint: c.fingerprint,
        decision: "APPROVE_REVIEWED",
      },
      pending,
    ).catch((e: unknown) => e);
    expect((err as DomainError).code).toBe("conflict");
    expect((err as Error).message).toMatch(/awaiting the owner's approval/);
  });
});

describe("approving an exact version", () => {
  it("approves, stamps the role, writes history and an audit entry", async () => {
    const c = await item("CHARACTER", "鹿");
    const review = await recordReview(
      prisma,
      reviewer,
      {
        entityType: "CHARACTER",
        entityId: c.entityId,
        fingerprint: c.fingerprint,
        decision: "APPROVE_REVIEWED",
      },
      approved,
    );
    expect(review).toMatchObject({
      decision: "APPROVED",
      level: "REVIEWED",
      reviewerRole: "CONTENT_REVIEWER",
    });
    const row = await prisma.character.findUniqueOrThrow({ where: { id: c.entityId } });
    expect(row).toMatchObject({ verification: "REVIEWED", reviewerRole: "CONTENT_REVIEWER" });
    expect(
      await prisma.auditLog.count({
        where: {
          action: "content.review.approve",
          createdAt: { gte: STARTED },
          entityId: c.entityId,
        },
      }),
    ).toBe(1);
    expect((await item("CHARACTER", "鹿")).status).toBe("approved");
  });

  it("refuses a decision on a version the reviewer didn't see", async () => {
    const c = await item("CHARACTER", "熊");
    const stale = `v1:${"0".repeat(64)}`;
    expect(
      await code(
        recordReview(
          prisma,
          reviewer,
          {
            entityType: "CHARACTER",
            entityId: c.entityId,
            fingerprint: stale,
            decision: "APPROVE_REVIEWED",
          },
          approved,
        ),
      ),
    ).toBe("conflict");
  });

  it("refuses self-review: whoever changed this version can't approve it", async () => {
    const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "龟" } });
    await updateCharacter(prisma, editorReviewer, c.id, {
      pinyin: "guī",
      pinyinAlternatives: "",
      meaning: "tortoise; turtle",
      source: c.source,
      licenseStatus: c.licenseStatus,
    });
    const q = await item("CHARACTER", "龟");
    expect(
      await code(
        recordReview(
          prisma,
          editorReviewer,
          {
            entityType: "CHARACTER",
            entityId: q.entityId,
            fingerprint: q.fingerprint,
            decision: "APPROVE_REVIEWED",
          },
          approved,
        ),
      ),
    ).toBe("forbidden");
    // Another reviewer may.
    expect(
      await code(
        recordReview(
          prisma,
          reviewer2,
          {
            entityType: "CHARACTER",
            entityId: q.entityId,
            fingerprint: q.fingerprint,
            decision: "APPROVE_REVIEWED",
          },
          approved,
        ),
      ),
    ).toBe("ok");
  });

  it("refuses VERIFIED when a source's licence is unknown", async () => {
    const unknown = parseSourceRegister({
      sources: approved.sources.map((s) => ({ ...s, licenseStatus: "UNKNOWN" })),
    });
    const w = await item("VOCABULARY", "熊", unknown);
    expect(w.blockers.VERIFIED.map((b) => b.code)).toContain("licence-unknown");
    // REVIEWED doesn't need a known licence; a second reviewer's VERIFIED does (D-075).
    await recordReview(
      prisma,
      reviewer,
      {
        entityType: "VOCABULARY",
        entityId: w.entityId,
        fingerprint: w.fingerprint,
        decision: "APPROVE_REVIEWED",
      },
      unknown,
    );
    const refused = await recordReview(
      prisma,
      reviewer2,
      {
        entityType: "VOCABULARY",
        entityId: w.entityId,
        fingerprint: w.fingerprint,
        decision: "APPROVE_VERIFIED",
      },
      unknown,
    ).catch((e: unknown) => e);
    expect((refused as Error).message).toMatch(/unknown licence/);
    // The first reviewer can't be the second (D-075).
    expect(
      await code(
        recordReview(
          prisma,
          reviewer,
          {
            entityType: "VOCABULARY",
            entityId: w.entityId,
            fingerprint: w.fingerprint,
            decision: "APPROVE_VERIFIED",
          },
          unknown,
        ),
      ),
    ).toBe("forbidden");
  });
});

describe("an approval applies to one version only", () => {
  it("an edit returns the item to PROVISIONAL, audited, and the queue shows what changed", async () => {
    const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "鹿" } });
    expect(c.verification).toBe("REVIEWED");
    await updateCharacter(prisma, editor, c.id, {
      pinyin: "lù",
      pinyinAlternatives: "",
      meaning: "deer (animal)",
      source: c.source,
      licenseStatus: c.licenseStatus,
    });
    const after = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({
      verification: "PROVISIONAL",
      reviewerRole: null,
      reviewedAt: null,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          action: "content.review.invalidated",
          createdAt: { gte: STARTED },
          entityId: c.id,
        },
      }),
    ).toBe(1);
    const q = await item("CHARACTER", "鹿");
    expect(q.status).toBe("stale");
    expect(q.changedSinceApproval).toEqual(["meaning"]);
    // History is preserved.
    expect(await prisma.contentReview.count({ where: { entityId: c.id } })).toBe(1);
  });

  it("a provenance change through an import also invalidates the approval", async () => {
    // Approve the current versions of 鹿 and 熊.
    for (const h of ["鹿", "熊"]) {
      const c = await item("CHARACTER", h);
      if (c.status !== "approved")
        await recordReview(
          prisma,
          reviewer,
          {
            entityType: "CHARACTER",
            entityId: c.entityId,
            fingerprint: c.fingerprint,
            decision: "APPROVE_REVIEWED",
          },
          approved,
        );
    }
    const deer = await prisma.character.findUniqueOrThrow({ where: { hanzi: "鹿" } });
    expect(deer.verification).toBe("REVIEWED");
    // Re-import with an extra source on 鹿 only: its version changes, 熊's doesn't.
    await importIt(null, ["hanzi-writer-data-2.0.1"]);
    const deerAfter = await prisma.character.findUniqueOrThrow({ where: { id: deer.id } });
    expect(deerAfter.sourceRefs).toContain("hanzi-writer-data-2.0.1");
    expect(deerAfter.verification).toBe("PROVISIONAL");
    expect(
      await prisma.auditLog.count({
        where: {
          action: "content.review.invalidated",
          createdAt: { gte: STARTED },
          entityId: deer.id,
        },
      }),
    ).toBeGreaterThanOrEqual(2); // the edit earlier, and this import
    const q = await item("CHARACTER", "鹿");
    expect(q.changedSinceApproval).toEqual(["sourceRefs"]);
    const bear = await prisma.character.findUniqueOrThrow({ where: { hanzi: "熊" } });
    expect(bear.verification).toBe("REVIEWED");
  });
});

describe("requesting changes and curriculum approval", () => {
  it("requires a note, withdraws an approval and keeps the history", async () => {
    const w = await item("VOCABULARY", "龟");
    expect(
      await code(
        recordReview(
          prisma,
          reviewer,
          {
            entityType: "VOCABULARY",
            entityId: w.entityId,
            fingerprint: w.fingerprint,
            decision: "REQUEST_CHANGES",
          },
          approved,
        ),
      ),
    ).not.toBe("ok");
    await recordReview(
      prisma,
      reviewer,
      {
        entityType: "VOCABULARY",
        entityId: w.entityId,
        fingerprint: w.fingerprint,
        decision: "APPROVE_REVIEWED",
      },
      approved,
    );
    await recordReview(
      prisma,
      reviewer2,
      {
        entityType: "VOCABULARY",
        entityId: w.entityId,
        fingerprint: w.fingerprint,
        decision: "REQUEST_CHANGES",
        note: "Gloss should mention 'turtle'.",
      },
      approved,
    );
    const row = await prisma.vocabulary.findUniqueOrThrow({ where: { id: w.entityId } });
    expect(row.verification).toBe("PROVISIONAL");
    expect((await item("VOCABULARY", "龟")).status).toBe("changes-requested");
    expect(await prisma.contentReview.count({ where: { entityId: w.entityId } })).toBe(2);
  });

  it("a curriculum is approved only when all its items are, and loses approval when one changes", async () => {
    const cur = await item("CURRICULUM", "Review IT");
    expect(cur.blockers.REVIEWED.map((b) => b.code)).toContain("items-not-approved");
    expect(
      await code(
        recordReview(
          prisma,
          reviewer,
          {
            entityType: "CURRICULUM",
            entityId: curriculumId,
            fingerprint: cur.fingerprint,
            decision: "APPROVE_REVIEWED",
          },
          approved,
        ),
      ),
    ).toBe("conflict");
    // Approve every item that isn't currently approved.
    for (const q of await reviewQueue(prisma, curriculumId, approved))
      if (q.entityType !== "CURRICULUM" && q.status !== "approved")
        await recordReview(
          prisma,
          reviewer,
          {
            entityType: q.entityType,
            entityId: q.entityId,
            fingerprint: q.fingerprint,
            decision: "APPROVE_REVIEWED",
          },
          approved,
        );
    const ready = await item("CURRICULUM", "Review IT");
    expect(ready.blockers.REVIEWED).toEqual([]);
    await recordReview(
      prisma,
      reviewer,
      {
        entityType: "CURRICULUM",
        entityId: curriculumId,
        fingerprint: ready.fingerprint,
        decision: "APPROVE_REVIEWED",
      },
      approved,
    );
    expect(
      (await prisma.curriculum.findUniqueOrThrow({ where: { id: curriculumId } })).verification,
    ).toBe("REVIEWED");
    const progress = await reviewProgress(prisma, curriculumId, approved);
    expect(progress).toMatchObject({ curriculum: "approved", total: 6 });
    expect(progress.byStatus.approved).toBe(6);

    // Change one word: the word and the curriculum both return to PROVISIONAL.
    const w = await prisma.vocabulary.findFirstOrThrow({
      where: { simplified: "熊", pinyin: "xióng" },
    });
    await updateVocabulary(prisma, editor, w.id, {
      meaning: "bear (animal)",
      traditional: "",
      partOfSpeech: "",
      exampleZh: "",
      examplePinyin: "",
      exampleEn: "",
      source: w.source,
      licenseStatus: w.licenseStatus,
    });
    expect((await prisma.vocabulary.findUniqueOrThrow({ where: { id: w.id } })).verification).toBe(
      "PROVISIONAL",
    );
    expect(
      (await prisma.curriculum.findUniqueOrThrow({ where: { id: curriculumId } })).verification,
    ).toBe("PROVISIONAL");
    expect((await reviewProgress(prisma, curriculumId, approved)).curriculum).toBe("stale");
  });

  it("covers the curriculum's items and structure", async () => {
    const items = await curriculumItems(prisma, curriculumId);
    expect(items.characterIds).toHaveLength(3);
    expect(items.vocabularyIds).toHaveLength(3);
    expect(items.structureIds.length).toBeGreaterThanOrEqual(3);
  });
});

describe("concurrency", () => {
  it("an approval racing an edit never leaves an approved status on changed content", async () => {
    for (let i = 0; i < 5; i += 1) {
      const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "龟" } });
      const q = await item("CHARACTER", "龟");
      const results = await Promise.allSettled([
        recordReview(
          prisma,
          reviewer,
          {
            entityType: "CHARACTER",
            entityId: q.entityId,
            fingerprint: q.fingerprint,
            decision: "APPROVE_REVIEWED",
          },
          approved,
        ),
        updateCharacter(prisma, editor, c.id, {
          pinyin: "guī",
          pinyinAlternatives: "",
          meaning: `tortoise (race ${RUN}-${i})`,
          source: c.source,
          licenseStatus: c.licenseStatus,
        }),
      ]);

      // The edit must always succeed (no deadlock); the approval either committed first and was
      // invalidated by the edit, or was refused because the version had changed.
      expect(results[1]!.status, `round ${i}: edit`).toBe("fulfilled");

      const after = await item("CHARACTER", "龟");
      expect(after.verification, `round ${i}`).toBe("PROVISIONAL");
      expect(after.status, `round ${i}`).not.toBe("approved");
    }
  });
});
