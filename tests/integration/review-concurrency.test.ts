/**
 * M14-b review integrity under concurrency, repeated decisions, source changes and rollbacks.
 *
 * Invariant checked after every round: no character, word or curriculum holds REVIEWED or
 * VERIFIED unless its latest approval is for its exact current version, at that level, and its
 * sources still allow that level. No transaction deadlocks (every edit and import must succeed).
 * Concurrent approvals of one version record it once. (The same version can rightly be approved
 * again later, after an invalidation, when content returns to an earlier state.)
 *
 * Uses characters no other test touches (鸭 鹅 狮). Approvals need an approved source; the
 * repository register has none, so tests use an in-memory copy with approved entries.
 * Rounds per race: REVIEW_RACE_ROUNDS (default 10).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { DomainError, type Actor } from "@/features/administration/services";
import {
  updateCharacter,
  updateLesson,
  updateVocabulary,
} from "@/features/administration/curriculum-admin";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { parseSourceRegister, sourceRegister } from "@/features/curriculum/sources";
import {
  reconcileAllReviews,
  recordReview,
  reviewQueue,
  type QueueItem,
} from "@/features/curriculum/review";
import type { StrokeData } from "@/features/curriculum/stroke-data";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const STARTED = new Date();
const ROUNDS = Number(process.env.REVIEW_RACE_ROUNDS ?? 10);
const CHARS = ["鸭", "鹅", "狮"];
const strokes = (n: number): StrokeData => ({
  strokes: Array.from({ length: n }, () => "M 0 0"),
  medians: Array.from({ length: n }, () => [
    [0, 0],
    [1, 1],
  ]),
});

const approved = parseSourceRegister({
  sources: sourceRegister().sources.map((s) => ({
    ...s,
    approval: { status: "APPROVED", approverRole: "SUPER_ADMIN", approvedOn: "2026-11-13" },
  })),
});
const pending = sourceRegister();

let reviewerA: Actor;
let reviewerB: Actor;
let editor: Actor;
let curriculumId: string;
/** Rounds that completed with the invariant holding, per race (reported in the summary). */
const completed: Record<string, number> = {};
/** How each race's approval ended (committed first, or refused): both orders should occur. */
const outcomes: Record<string, Record<string, number>> = {};
const tally = (race: string, r: PromiseSettledResult<unknown>) => {
  const key = r.status === "fulfilled" ? "approval committed" : "approval refused";
  outcomes[race] = { ...outcomes[race], [key]: (outcomes[race]?.[key] ?? 0) + 1 };
};

async function user(prefix: string, roles: Actor["roles"]): Promise<Actor> {
  const r = await registerUser(prisma, {
    displayName: prefix,
    email: uniqueEmail(prefix),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return { id: r.userId, roles };
}

const content = () => ({
  curriculum: {
    slug: `race-${RUN}`,
    name: "Race IT",
    framework: "CUSTOM",
    version: `race-${RUN}`,
    source: "integration test",
    sourceRefs: ["hanziquest-authored"],
    licenseStatus: "ORIGINAL",
    verification: "PROVISIONAL",
  },
  level: { level: 1, name: "L1" },
  characters: {
    鸭: { pinyin: "yā", meaning: "duck" },
    鹅: { pinyin: "é", meaning: "goose" },
    狮: { pinyin: "shī", meaning: "lion" },
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
            { simplified: "鸭", pinyin: "yā", meaning: "duck" },
            { simplified: "鹅", pinyin: "é", meaning: "goose" },
            { simplified: "狮", pinyin: "shī", meaning: "lion" },
          ],
        },
      ],
    },
  ],
});

/**
 * Imports the fixture. `duckStrokes` sets 鸭's stroke count: an import rewrites strokes whose
 * count differs, which changes 鸭's version (imports never overwrite a reviewed reading).
 */
async function importIt(duckStrokes = 1, onImported?: () => Promise<void>) {
  const lookup = (h: string) => strokes(h === "鸭" ? duckStrokes : 1);
  const v = validateCurriculumContent(content(), lookup);
  expect(v.ok).toBe(true);
  return importCurriculumContent(prisma, v.content!, {
    publishNewLessons: true,
    lookupStrokes: lookup,
    ...(onImported && { onImported }),
  });
}

const queue = (register = approved) => reviewQueue(prisma, curriculumId, register);
async function item(type: QueueItem["entityType"], title: string, register = approved) {
  return (await queue(register)).find((x) => x.entityType === type && x.title === title)!;
}

const approve = (
  actor: Actor,
  q: Pick<QueueItem, "entityType" | "entityId" | "fingerprint">,
  decision: "APPROVE_REVIEWED" | "APPROVE_VERIFIED" = "APPROVE_REVIEWED",
  register = approved,
) =>
  recordReview(
    prisma,
    actor,
    { entityType: q.entityType, entityId: q.entityId, fingerprint: q.fingerprint, decision },
    register,
  );

/** Approves every item (and then the curriculum) that isn't approved yet. */
async function approveAll(actor: Actor) {
  for (const q of await queue())
    if (q.entityType !== "CURRICULUM" && q.status !== "approved") await approve(actor, q);
  const cur = await item("CURRICULUM", "Race IT");
  if (cur.status !== "approved") await approve(actor, cur);
}

/**
 * Staggers the approval in a race: even rounds start it at once, odd rounds after 0 to 30 ms, so
 * that over the rounds both the approval and the competing change get to commit first.
 */
const staggered = <T>(i: number, run: () => Promise<T>) =>
  i % 2 === 0 ? run() : new Promise<void>((r) => setTimeout(r, ((i >> 1) % 4) * 10)).then(run);
const why = (r: PromiseSettledResult<unknown>) =>
  r.status === "rejected" ? String(r.reason).slice(0, 300) : "";
const isDeadlock = (r: PromiseSettledResult<unknown>) =>
  r.status === "rejected" && /deadlock|40P01/i.test(String(r.reason));
const expectedRefusal = (r: PromiseSettledResult<unknown>) =>
  r.status === "fulfilled" || (r.reason instanceof DomainError && r.reason.code === "conflict");

/** The integrity invariant (see the file comment). */
async function expectInvariant(label: string, register = approved) {
  for (const q of await queue(register)) {
    if (q.verification !== "PROVISIONAL")
      expect(q.status, `${label}: ${q.entityType} ${q.title} is ${q.verification}`).toBe(
        "approved",
      );
  }
}

beforeAll(async () => {
  await ensureRoles(prisma);
  reviewerA = await user("race-rev-a", ["CONTENT_REVIEWER"]);
  reviewerB = await user("race-rev-b", ["CONTENT_REVIEWER"]);
  editor = await user("race-editor", ["CURRICULUM_EDITOR"]);
  const chars = await prisma.character.findMany({ where: { hanzi: { in: CHARS } } });
  const words = await prisma.vocabulary.findMany({ where: { simplified: { in: CHARS } } });
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
  curriculumId = (await importIt()).curriculumId;
});

afterAll(async () => {
  console.log(`[review-concurrency] rounds completed: ${JSON.stringify(completed)}`);
  console.log(`[review-concurrency] outcomes: ${JSON.stringify(outcomes)}`);
  await prisma.$disconnect();
});

describe("races (each repeated)", () => {
  it("approval vs edit of the same word", async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const w = await prisma.vocabulary.findFirstOrThrow({ where: { simplified: "鹅" } });
      const q = await item("VOCABULARY", "鹅");
      const [a, e] = await Promise.allSettled([
        staggered(i, () => approve(reviewerA, q)),
        updateVocabulary(prisma, editor, w.id, {
          meaning: `goose (${RUN}-${i})`,
          traditional: "",
          partOfSpeech: "",
          exampleZh: "",
          examplePinyin: "",
          exampleEn: "",
          source: w.source,
          licenseStatus: w.licenseStatus,
        }),
      ]);
      expect(e!.status, `round ${i}: edit ${why(e!)}`).toBe("fulfilled");
      expect(expectedRefusal(a!), `round ${i}: approval ${why(a!)}`).toBe(true);
      await expectInvariant(`edit round ${i}`);
      tally("approval-vs-edit", a!);
      completed["approval-vs-edit"] = i + 1;
    }
  });

  it("approval vs an import that changes the item's sources", async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const q = await item("CHARACTER", "鸭");
      const before = await prisma.characterStroke.count({ where: { characterId: q.entityId } });
      const [a, imp] = await Promise.allSettled([
        staggered(i, () => approve(reviewerA, q)),
        importIt(before === 1 ? 2 : 1),
      ]);
      expect(imp!.status, `round ${i}: import ${why(imp!)}`).toBe("fulfilled");
      expect(isDeadlock(a!), `round ${i}: approval deadlocked`).toBe(false);
      expect(expectedRefusal(a!), `round ${i}: approval ${why(a!)}`).toBe(true);
      // The import changed 鸭's version, so it can't be approved now, whichever ran first.
      expect((await item("CHARACTER", "鸭")).verification, `round ${i}`).toBe("PROVISIONAL");
      await expectInvariant(`import round ${i}`);
      tally("approval-vs-import", a!);
      completed["approval-vs-import"] = i + 1;
    }
  });

  it("two edits of the same item both apply, one after the other", async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "狮" } });
      const revisionsBefore = await prisma.contentRevision.count({ where: { entityId: c.id } });
      const edit = (m: string) =>
        updateCharacter(prisma, editor, c.id, {
          pinyin: "shī",
          pinyinAlternatives: "",
          meaning: m,
          source: c.source,
          licenseStatus: c.licenseStatus,
        });
      const results = await Promise.allSettled([edit(`lion A${i}`), edit(`lion B${i}`)]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const after = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
      expect([`lion A${i}`, `lion B${i}`]).toContain(after.meaning);
      expect(await prisma.contentRevision.count({ where: { entityId: c.id } })).toBe(
        revisionsBefore + 2,
      );
      await expectInvariant(`edits round ${i}`);
      completed["edit-vs-edit"] = i + 1;
    }
  });

  it("two reviewers approving the same version: one approval, the other refused", async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      // Give 狮 a new version, then race two approvals of it.
      const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "狮" } });
      await updateCharacter(prisma, editor, c.id, {
        pinyin: "shī",
        pinyinAlternatives: "",
        meaning: `lion (${RUN}-two-${i})`,
        source: c.source,
        licenseStatus: c.licenseStatus,
      });
      const q = await item("CHARACTER", "狮");
      const results = await Promise.allSettled([
        approve(reviewerA, q),
        staggered(i, () => approve(reviewerB, q)),
      ]);
      expect(
        results.filter((r) => r.status === "fulfilled"),
        `round ${i}`,
      ).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(DomainError);
      expect((refused.reason as Error).message).toMatch(/already approved/);
      expect(
        await prisma.contentReview.count({
          where: { entityId: q.entityId, fingerprint: q.fingerprint, decision: "APPROVED" },
        }),
      ).toBe(1);
      await expectInvariant(`two reviewers round ${i}`);
      completed["reviewer-vs-reviewer"] = i + 1;
    }
  });

  it("approval vs request for changes on the same version: either order is consistent", async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "狮" } });
      await updateCharacter(prisma, editor, c.id, {
        pinyin: "shī",
        pinyinAlternatives: "",
        meaning: `lion (${RUN}-rc-${i})`,
        source: c.source,
        licenseStatus: c.licenseStatus,
      });
      const q = await item("CHARACTER", "狮");
      const results = await Promise.allSettled([
        staggered(i, () => approve(reviewerA, q)),
        recordReview(
          prisma,
          reviewerB,
          {
            entityType: "CHARACTER",
            entityId: q.entityId,
            fingerprint: q.fingerprint,
            decision: "REQUEST_CHANGES",
            note: "Race: please check.",
          },
          approved,
        ),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      // The later decision wins, and the status matches it.
      const latest = await prisma.contentReview.findFirstOrThrow({
        where: { entityId: q.entityId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const row = await prisma.character.findUniqueOrThrow({ where: { id: q.entityId } });
      expect(row.verification).toBe(latest.decision === "APPROVED" ? "REVIEWED" : "PROVISIONAL");
      await expectInvariant(`approve vs request round ${i}`);
      completed["approve-vs-request-changes"] = i + 1;
    }
  });

  it("curriculum approval vs a structure edit", async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      await approveAll(reviewerA);
      const lesson = await prisma.lesson.findFirstOrThrow({
        where: { unit: { level: { curriculumId } } },
      });
      // Make the curriculum approvable again, then race its approval with a lesson rename.
      const cur = await item("CURRICULUM", "Race IT");
      if (cur.status === "approved")
        await recordReview(
          prisma,
          reviewerB,
          {
            entityType: "CURRICULUM",
            entityId: curriculumId,
            fingerprint: cur.fingerprint,
            decision: "REQUEST_CHANGES",
            note: "Race: reset.",
          },
          approved,
        );
      const ready = await item("CURRICULUM", "Race IT");
      const [a, e] = await Promise.allSettled([
        staggered(i, () => approve(reviewerA, ready)),
        updateLesson(prisma, editor, lesson.id, {
          title: `L ${RUN}-${i}`,
          description: "",
          position: lesson.position,
        }),
      ]);
      expect(e!.status, `round ${i}: edit ${why(e!)}`).toBe("fulfilled");
      expect(expectedRefusal(a!), `round ${i}: approval ${why(a!)}`).toBe(true);
      const after = await item("CURRICULUM", "Race IT");
      expect(after.verification).toBe("PROVISIONAL");
      await expectInvariant(`structure round ${i}`);
      tally("curriculum-approval-vs-structure-edit", a!);
      completed["curriculum-approval-vs-structure-edit"] = i + 1;
    }
  });

  it("an edit and an import of the same items don't deadlock", async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "鸭" } });
      const results = await Promise.allSettled([
        updateCharacter(prisma, editor, c.id, {
          pinyin: "yā",
          pinyinAlternatives: "",
          meaning: `duck (${RUN}-${i})`,
          source: c.source,
          licenseStatus: c.licenseStatus,
        }),
        importIt(i % 2 === 0 ? 1 : 2),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      await expectInvariant(`edit vs import round ${i}`);
      completed["edit-vs-import"] = i + 1;
    }
  });
});

describe("repeated decisions, source changes and rollbacks", () => {
  it("a repeated approval is refused and writes nothing; raising to VERIFIED is allowed", async () => {
    const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "鹅" } });
    await updateCharacter(prisma, editor, c.id, {
      pinyin: "é",
      pinyinAlternatives: "",
      meaning: `goose (${RUN}-repeat)`,
      source: c.source,
      licenseStatus: c.licenseStatus,
    });
    const q = await item("CHARACTER", "鹅");
    await approve(reviewerA, q);
    const rows = await prisma.contentReview.count({ where: { entityId: q.entityId } });
    const audits = await prisma.auditLog.count({ where: { entityId: q.entityId } });
    await expect(approve(reviewerB, q)).rejects.toThrow(/already approved as reviewed/);
    expect(await prisma.contentReview.count({ where: { entityId: q.entityId } })).toBe(rows);
    expect(await prisma.auditLog.count({ where: { entityId: q.entityId } })).toBe(audits);
    await approve(reviewerB, q, "APPROVE_VERIFIED");
    expect((await item("CHARACTER", "鹅")).verification).toBe("VERIFIED");
    await expect(approve(reviewerA, q, "APPROVE_REVIEWED")).rejects.toThrow(
      /already approved as verified/,
    );
    await expectInvariant("repeat");
  });

  it("a withdrawn source approval invalidates approvals (preview first, then apply)", async () => {
    await approveAll(reviewerA);
    const before = await queue();
    const nonProvisional = before.filter((q) => q.verification !== "PROVISIONAL");
    expect(nonProvisional.length).toBeGreaterThan(0);
    // Under the real register (sources awaiting the owner), the queue already shows them stale.
    for (const q of await queue(pending))
      if (q.verification !== "PROVISIONAL") {
        expect(q.status).toBe("stale");
        expect(q.changedSinceApproval.length).toBeGreaterThan(0);
      }
    const preview = await reconcileAllReviews(prisma, { apply: false, register: pending });
    const ids = new Set(nonProvisional.map((q) => q.entityId));
    expect(preview.filter((x) => ids.has(x.id))).toHaveLength(ids.size);
    expect((await item("CURRICULUM", "Race IT")).verification).not.toBe("PROVISIONAL");
    const applied = await reconcileAllReviews(prisma, { apply: true, register: pending });
    expect(applied.filter((x) => ids.has(x.id))).toHaveLength(ids.size);
    for (const q of await queue(pending)) expect(q.verification).toBe("PROVISIONAL");
    expect(
      await prisma.auditLog.count({
        where: {
          action: "content.review.invalidated",
          entityId: { in: [...ids] },
          createdAt: { gte: STARTED },
          actorId: null,
        },
      }),
    ).toBeGreaterThanOrEqual(ids.size);
    await expectInvariant("withdrawn source", pending);
  });

  it("a failed import rolls back its invalidations; a refused approval writes nothing", async () => {
    await approveAll(reviewerA);
    const duck = await prisma.character.findUniqueOrThrow({ where: { hanzi: "鸭" } });
    const invalidations = () =>
      prisma.auditLog.count({
        where: { action: "content.review.invalidated", entityId: duck.id },
      });
    const before = { verification: duck.verification, invalidations: await invalidations() };
    expect(before.verification).toBe("REVIEWED");
    // Changes 鸭's strokes (which invalidates it), then fails inside the transaction.
    const count = await prisma.characterStroke.count({ where: { characterId: duck.id } });
    await expect(
      importIt(count === 1 ? 2 : 1, async () => {
        throw new Error("simulated failure after reconciling");
      }),
    ).rejects.toThrow(/simulated failure/);
    const after = await prisma.character.findUniqueOrThrow({ where: { id: duck.id } });
    expect(after.verification).toBe("REVIEWED");
    expect(after.strokeCount).toBe(duck.strokeCount);
    expect(await prisma.characterStroke.count({ where: { characterId: duck.id } })).toBe(count);
    expect(await invalidations()).toBe(before.invalidations);

    // A refused approval (sources awaiting the owner) leaves no review row and no audit entry.
    const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "狮" } });
    await updateCharacter(prisma, editor, c.id, {
      pinyin: "shī",
      pinyinAlternatives: "",
      meaning: `lion (${RUN}-refused)`,
      source: c.source,
      licenseStatus: c.licenseStatus,
    });
    const q = await item("CHARACTER", "狮", pending);
    const rows = await prisma.contentReview.count({ where: { entityId: q.entityId } });
    const audits = await prisma.auditLog.count({ where: { entityId: q.entityId } });
    await expect(approve(reviewerA, q, "APPROVE_REVIEWED", pending)).rejects.toThrow(
      /Can't approve/,
    );
    expect(await prisma.contentReview.count({ where: { entityId: q.entityId } })).toBe(rows);
    expect(await prisma.auditLog.count({ where: { entityId: q.entityId } })).toBe(audits);
    await expectInvariant("rollback");
  });
});
