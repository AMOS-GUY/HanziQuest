/**
 * D-074: content files can't inject REVIEWED or VERIFIED, by any route.
 * D-075: VERIFIED needs two independent reviewers, for every role.
 *
 * Uses characters no other test touches (豹 蛙). Approvals need an approved source; the
 * repository register has none, so tests use an in-memory copy with approved entries.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { DomainError, type Actor } from "@/features/administration/services";
import { updateCharacter } from "@/features/administration/curriculum-admin";
import { ContentStatusError, importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import type { CurriculumContent } from "@/features/curriculum/content-schema";
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
const ROUNDS = Number(process.env.REVIEW_RACE_ROUNDS ?? 10);
const CHARS = ["豹", "蛙"];
const fake: StrokeData = {
  strokes: ["M 0 0"],
  medians: [
    [
      [0, 0],
      [1, 1],
    ],
  ],
};
const approved = parseSourceRegister({
  sources: sourceRegister().sources.map((s) => ({
    ...s,
    approval: { status: "APPROVED", approverRole: "SUPER_ADMIN", approvedOn: "2026-11-13" },
  })),
});

let reviewerA: Actor;
let reviewerB: Actor;
let reviewerC: Actor;
let superAdmin: Actor;
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

const raw = (
  slug: string,
  overrides: { verification?: string; exampleVerification?: string } = {},
) => ({
  curriculum: {
    slug,
    name: `Status IT ${slug}`,
    framework: "CUSTOM",
    version: slug,
    source: "integration test",
    sourceRefs: ["hanziquest-authored"],
    licenseStatus: "ORIGINAL",
    verification: overrides.verification ?? "PROVISIONAL",
  },
  level: { level: 1, name: "L1" },
  characters: { 豹: { pinyin: "bào", meaning: "leopard" }, 蛙: { pinyin: "wā", meaning: "frog" } },
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
              simplified: "豹",
              pinyin: "bào",
              meaning: "leopard",
              ...(overrides.exampleVerification && {
                example: {
                  zh: "豹！",
                  pinyin: "bào!",
                  en: "A leopard!",
                  sourceRef: "hanziquest-authored",
                  verification: overrides.exampleVerification,
                },
              }),
            },
            { simplified: "蛙", pinyin: "wā", meaning: "frog" },
          ],
        },
      ],
    },
  ],
});

const valid = (slug: string) => {
  const v = validateCurriculumContent(raw(slug), () => fake, sourceRegister());
  expect(v.ok, JSON.stringify(v.issues)).toBe(true);
  return v.content!;
};
const importContent = (content: CurriculumContent) =>
  importCurriculumContent(prisma, content, { publishNewLessons: true, lookupStrokes: () => fake });

const queue = () => reviewQueue(prisma, curriculumId, approved);
const item = async (type: QueueItem["entityType"], title: string) =>
  (await queue()).find((x) => x.entityType === type && x.title === title)!;
const decide = (
  actor: Actor,
  q: Pick<QueueItem, "entityType" | "entityId" | "fingerprint">,
  decision: "APPROVE_REVIEWED" | "APPROVE_VERIFIED",
  register = approved,
) =>
  recordReview(
    prisma,
    actor,
    { entityType: q.entityType, entityId: q.entityId, fingerprint: q.fingerprint, decision },
    register,
  );
const failure = (p: Promise<unknown>) =>
  p.then(
    () => ({ code: "ok", message: "" }),
    (e: unknown) => ({
      code: e instanceof DomainError ? e.code : "error",
      message: e instanceof Error ? e.message : String(e),
    }),
  );

/** Gives 豹 a new version, edited by the editor-reviewer, and returns its queue item. */
async function newLeopardVersion(tag: string) {
  const c = await prisma.character.findUniqueOrThrow({ where: { hanzi: "豹" } });
  await updateCharacter(prisma, editorReviewer, c.id, {
    pinyin: "bào",
    pinyinAlternatives: "",
    meaning: `leopard (${RUN}-${tag})`,
    source: c.source,
    licenseStatus: c.licenseStatus,
  });
  return item("CHARACTER", "豹");
}

/**
 * Invariant: every VERIFIED item's latest approval is VERIFIED for its exact current version,
 * and a REVIEWED approval of that same version by a different reviewer precedes it.
 */
async function expectIndependentVerification(label: string) {
  for (const q of await queue()) {
    if (q.verification !== "VERIFIED") continue;
    expect(q.status, `${label}: ${q.title}`).toBe("approved");
    const rows = await prisma.contentReview.findMany({
      where: { entityId: q.entityId, fingerprint: q.fingerprint, decision: "APPROVED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const verified = rows.filter((r) => r.level === "VERIFIED");
    expect(verified, `${label}: one VERIFIED approval of ${q.title}`).toHaveLength(1);
    const reviewed = rows.filter(
      (r) => r.level === "REVIEWED" && r.createdAt <= verified[0]!.createdAt,
    );
    expect(reviewed.length, `${label}: REVIEWED first for ${q.title}`).toBeGreaterThan(0);
    expect(
      reviewed.some((r) => r.reviewerId !== verified[0]!.reviewerId),
      `${label}: a different reviewer verified ${q.title}`,
    ).toBe(true);
  }
}

beforeAll(async () => {
  await ensureRoles(prisma);
  reviewerA = await user("status-a", ["CONTENT_REVIEWER"]);
  reviewerB = await user("status-b", ["CONTENT_REVIEWER"]);
  reviewerC = await user("status-c", ["CONTENT_REVIEWER"]);
  superAdmin = await user("status-super", ["SUPER_ADMIN"]);
  editorReviewer = await user("status-editrev", ["CURRICULUM_EDITOR", "CONTENT_REVIEWER"]);
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
  curriculumId = (await importContent(valid(`status-${RUN}`))).curriculumId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("D-074: content files can't declare REVIEWED or VERIFIED", () => {
  const cases = [
    { where: "curriculum", overrides: (v: string) => ({ verification: v }) },
    { where: "example", overrides: (v: string) => ({ exampleVerification: v }) },
  ];

  it("the validator refuses them with a clear message, and doesn't downgrade them", () => {
    for (const c of cases)
      for (const v of ["REVIEWED", "VERIFIED"]) {
        // With the real register and with every source approved: the status is never accepted.
        for (const register of [sourceRegister(), approved]) {
          const r = validateCurriculumContent(
            raw(`x-${RUN}`, c.overrides(v)),
            () => fake,
            register,
          );
          expect(r.ok, `${c.where} ${v}`).toBe(false);
          expect(r.content).toBeNull();
          expect(r.issues.map((i) => i.message).join(" ")).toMatch(
            /may only declare PROVISIONAL.*review workflow/,
          );
        }
      }
    // PROVISIONAL stays valid, examples included.
    expect(
      validateCurriculumContent(
        raw(`ok-${RUN}`, { exampleVerification: "PROVISIONAL" }),
        () => fake,
        sourceRegister(),
      ).ok,
    ).toBe(true);
  });

  it("the importer refuses them even when validation is skipped, and writes nothing", async () => {
    for (const c of cases)
      for (const v of ["REVIEWED", "VERIFIED"] as const) {
        const slug = `inject-${c.where}-${v.toLowerCase()}-${RUN}`;
        const content = valid(slug);
        // Bypasses the types on purpose: a caller that never validated the file.
        if (c.where === "curriculum") content.curriculum.verification = v as "PROVISIONAL";
        else
          content.units[0]!.lessons[0]!.words[0]!.example = {
            zh: "豹！",
            pinyin: "bào!",
            en: "A leopard!",
            sourceRef: "hanziquest-authored",
            verification: v as "PROVISIONAL",
          };
        const err = await importContent(content).catch((e: unknown) => e);
        expect(err, `${c.where} ${v}`).toBeInstanceOf(ContentStatusError);
        expect((err as Error).message).toMatch(/may only declare PROVISIONAL/);
        expect((err as Error).message).toContain(v);
        expect(await prisma.curriculum.count({ where: { slug } })).toBe(0);
      }
    const leopard = await prisma.character.findUniqueOrThrow({ where: { hanzi: "豹" } });
    expect(leopard.verification).toBe("PROVISIONAL");
  });

  it("the CLI refuses them (content:validate, the same check as content:import)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-status-"));
    const file = path.join(dir, "verified.json");
    fs.writeFileSync(file, JSON.stringify(raw(`cli-${RUN}`, { verification: "VERIFIED" })));
    const result = await promisify(execFile)(
      process.execPath,
      [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/content.ts", "validate", file],
      { env: { ...process.env, DATABASE_URL: "" } },
    ).then(
      (r) => ({ code: 0, out: r.stdout }),
      (e: { code: number; stdout: string; stderr: string }) => ({
        code: e.code,
        out: e.stdout + e.stderr,
      }),
    );
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/may only declare PROVISIONAL/);
    expect(result.out).toMatch(/Validation failed/);
  });
});

describe("D-075: VERIFIED needs two independent reviewers", () => {
  it("can't skip REVIEWED, for reviewers or Super Admins", async () => {
    const q = await item("CHARACTER", "蛙");
    for (const actor of [reviewerA, superAdmin]) {
      const r = await failure(decide(actor, q, "APPROVE_VERIFIED"));
      expect(r.code).toBe("conflict");
      expect(r.message).toMatch(/needs a current Reviewed approval first/);
    }
    expect((await item("CHARACTER", "蛙")).verification).toBe("PROVISIONAL");
  });

  it("the same reviewer can't verify what they reviewed, Super Admins included", async () => {
    for (const actor of [reviewerA, superAdmin]) {
      const q = await newLeopardVersion(`same-${actor.roles[0]}`);
      await decide(actor, q, "APPROVE_REVIEWED");
      const r = await failure(decide(actor, q, "APPROVE_VERIFIED"));
      expect(r.code, actor.roles[0]).toBe("forbidden");
      expect(r.message).toMatch(/a different reviewer has to verify/);
      expect((await item("CHARACTER", "豹")).verification).toBe("REVIEWED");
    }
  });

  it("the author of a version can't verify it either", async () => {
    const q = await newLeopardVersion("author"); // edited by editorReviewer
    await decide(reviewerA, q, "APPROVE_REVIEWED");
    const r = await failure(decide(editorReviewer, q, "APPROVE_VERIFIED"));
    expect(r.code).toBe("forbidden");
    expect(r.message).toMatch(/changed or imported this version/);
  });

  it("a different reviewer verifies the exact version; both decisions are recorded and audited", async () => {
    const q = await newLeopardVersion("independent");
    const first = await decide(reviewerA, q, "APPROVE_REVIEWED");
    // A stale fingerprint is refused.
    const stale = await failure(
      decide(reviewerB, { ...q, fingerprint: `v1:${"0".repeat(64)}` }, "APPROVE_VERIFIED"),
    );
    expect(stale.code).toBe("conflict");
    expect(stale.message).toMatch(/changed after you opened it/);
    const second = await decide(reviewerB, q, "APPROVE_VERIFIED");
    expect(second.reviewerId).toBe(reviewerB.id);
    expect(first.reviewerId).toBe(reviewerA.id);
    expect(second.fingerprint).toBe(first.fingerprint);
    const row = await prisma.character.findUniqueOrThrow({ where: { id: q.entityId } });
    expect(row.verification).toBe("VERIFIED");
    const audits = await prisma.auditLog.findMany({
      where: { action: "content.review.approve", entityId: q.entityId },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    expect(audits.map((a) => a.actorId).sort()).toEqual([reviewerA.id, reviewerB.id].sort());
    expect(audits.map((a) => (a.after as { reviewId: string }).reviewId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    await expectIndependentVerification("independent");
  });

  it("source and licence rules apply before VERIFIED", async () => {
    const q = await newLeopardVersion("licence");
    await decide(reviewerA, q, "APPROVE_REVIEWED");
    const unknown = parseSourceRegister({
      sources: approved.sources.map((s) => ({ ...s, licenseStatus: "UNKNOWN" })),
    });
    const r = await failure(decide(reviewerB, q, "APPROVE_VERIFIED", unknown));
    expect(r.code).toBe("conflict");
    expect(r.message).toMatch(/unknown licence/);
    expect((await item("CHARACTER", "豹")).verification).toBe("REVIEWED");
  });

  it("a content change returns VERIFIED to PROVISIONAL; both approvals no longer apply", async () => {
    const q = await newLeopardVersion("verified-then-edited");
    await decide(reviewerA, q, "APPROVE_REVIEWED");
    await decide(reviewerB, q, "APPROVE_VERIFIED");
    const after = await newLeopardVersion("edit-after-verify");
    expect(after.verification).toBe("PROVISIONAL");
    expect(after.status).toBe("stale");
    // Verifying the new version needs a new REVIEWED approval first.
    const r = await failure(decide(reviewerB, after, "APPROVE_VERIFIED"));
    expect(r.code).toBe("conflict");
  });

  it("a withdrawn source approval returns VERIFIED to PROVISIONAL", async () => {
    const q = await newLeopardVersion("withdrawn");
    await decide(reviewerA, q, "APPROVE_REVIEWED");
    await decide(reviewerB, q, "APPROVE_VERIFIED");
    const invalidated = await reconcileAllReviews(prisma, {
      apply: true,
      register: sourceRegister(), // the repository's: sources await the owner
    });
    expect(invalidated.map((x) => x.id)).toContain(q.entityId);
    expect(
      (await prisma.character.findUniqueOrThrow({ where: { id: q.entityId } })).verification,
    ).toBe("PROVISIONAL");
  });

  it("concurrent verifications: two second reviewers record one VERIFIED (repeated)", async () => {
    for (let i = 0; i < ROUNDS; i += 1) {
      const q = await newLeopardVersion(`race-${i}`);
      await decide(reviewerA, q, "APPROVE_REVIEWED");
      const results = await Promise.allSettled([
        decide(reviewerB, q, "APPROVE_VERIFIED"),
        decide(reviewerC, q, "APPROVE_VERIFIED"),
      ]);
      expect(
        results.filter((r) => r.status === "fulfilled"),
        `round ${i}`,
      ).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((refused.reason as Error).message).toMatch(/already approved as verified/);
      await expectIndependentVerification(`race round ${i}`);
    }
  });

  it("concurrent first and second reviews: VERIFIED only ever follows another reviewer's REVIEWED (repeated)", async () => {
    let verifiedFirstRefused = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const q = await newLeopardVersion(`order-${i}`);
      // Even rounds delay the verification, odd rounds the first review: both orders occur.
      const later = <T>(ms: number, f: () => Promise<T>) =>
        new Promise((r) => setTimeout(r, ms)).then(f);
      const [, v] = await Promise.allSettled([
        later(i % 2 === 0 ? 0 : 40, () => decide(reviewerA, q, "APPROVE_REVIEWED")),
        later(i % 2 === 0 ? 40 : 0, () => decide(reviewerB, q, "APPROVE_VERIFIED")),
      ]);
      if (v!.status === "rejected") verifiedFirstRefused += 1;
      const row = await prisma.character.findUniqueOrThrow({ where: { id: q.entityId } });
      expect(row.verification).toBe(v!.status === "fulfilled" ? "VERIFIED" : "REVIEWED");
      await expectIndependentVerification(`order round ${i}`);
    }
    console.log(
      `[content-status] verification raced ahead of review and was refused in ${verifiedFirstRefused}/${ROUNDS} rounds`,
    );
    // Both orders must have occurred for the race to mean anything.
    expect(verifiedFirstRefused).toBeGreaterThan(0);
    expect(verifiedFirstRefused).toBeLessThan(ROUNDS);
  });

  it("a curriculum is VERIFIED only by a second reviewer, once every item is VERIFIED", async () => {
    // Verify every item independently (A reviews, B verifies).
    for (const q of await queue()) {
      if (q.entityType === "CURRICULUM") continue;
      if (q.verification === "PROVISIONAL") await decide(reviewerA, q, "APPROVE_REVIEWED");
      const now = await item(q.entityType, q.title);
      if (now.verification === "REVIEWED") await decide(reviewerB, now, "APPROVE_VERIFIED");
    }
    const cur = await item("CURRICULUM", `Status IT status-${RUN}`);
    expect((await failure(decide(reviewerA, cur, "APPROVE_VERIFIED"))).code).toBe("conflict");
    await decide(reviewerA, cur, "APPROVE_REVIEWED");
    expect((await failure(decide(reviewerA, cur, "APPROVE_VERIFIED"))).code).toBe("forbidden");
    await decide(
      reviewerC,
      await item("CURRICULUM", `Status IT status-${RUN}`),
      "APPROVE_VERIFIED",
    );
    expect(
      (await prisma.curriculum.findUniqueOrThrow({ where: { id: curriculumId } })).verification,
    ).toBe("VERIFIED");
    await expectIndependentVerification("curriculum");
  });
});
