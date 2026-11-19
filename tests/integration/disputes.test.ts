/**
 * M13 handwriting disputes (D-081) on the local test database. Synthetic ink only (generated
 * from reference strokes): no human handwriting.
 * - Ownership (no IDOR), eligibility, consent, no free text, the 14-day window, one per attempt
 *   (also under concurrent submission).
 * - Nothing changes grading or progress: the attempt, per-character results, mastery,
 *   schedules, XP and daily activity are identical before and after a dispute is submitted and
 *   decided.
 * - Reviewers: permission, no identifiers in the queue, no reviewing one's own dispute, one
 *   claim wins under concurrency, only the claimer decides, decided disputes stay decided.
 * - Account deletion removes the learner's disputes; audit entries remain without the actor.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { deleteAccount } from "@/features/account/account";
import { DomainError } from "@/features/administration/services";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { submitAttempt } from "@/features/exercises/attempts";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import {
  claimDispute,
  decideDispute,
  disputeQueue,
  learnerDisputes,
  releaseDispute,
  submitDispute,
  type DisputeActor,
} from "@/features/handwriting/disputes";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const PASSWORD = "password-1234";
let exerciseId: string;

async function learner(prefix: string, roles: DisputeActor["roles"] = ["LEARNER"]) {
  const r = await registerUser(prisma, {
    displayName: prefix,
    email: uniqueEmail(prefix),
    password: PASSWORD,
  });
  if (!r.ok) throw new Error("setup");
  for (const key of roles.filter((k) => k !== "LEARNER")) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.create({ data: { userId: r.userId, roleId: role.id } });
  }
  return { id: r.userId, roles } satisfies DisputeActor;
}

const ink = (hanzi: string, seed: number) =>
  toInk(fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians).medians, { seed });

/** A real, server-graded handwriting attempt: writes `drawn` when 人 is asked. */
async function attempt(userId: string, drawn: "人" | "大") {
  const clientEventId = randomUUID();
  const outcome = await submitAttempt(prisma, userId, {
    clientEventId,
    exerciseId,
    occurredAt: new Date().toISOString(),
    kind: "writing",
    drawings: [ink(drawn, 7)],
  });
  return { clientEventId, ...outcome };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof DomainError ? e.code : e instanceof Error ? e.name : "error"),
  );

/** Everything a dispute must never change, for one learner. */
async function progressSnapshot(userId: string) {
  return Promise.all([
    prisma.exerciseAttempt.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.attemptCharacterResult.findMany({
      where: { userId },
      orderBy: [{ attemptId: "asc" }, { position: "asc" }],
    }),
    prisma.characterMastery.findMany({ where: { userId }, orderBy: { characterId: "asc" } }),
    prisma.reviewSchedule.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.xPTransaction.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.dailyActivity.findMany({ where: { userId }, orderBy: { date: "asc" } }),
    prisma.streak.findUnique({ where: { userId } }),
  ]);
}

beforeAll(async () => {
  await ensureRoles(prisma);
  const v = validateCurriculumContent(
    {
      curriculum: {
        slug: `disputes-${RUN}`,
        name: "Disputes IT",
        framework: "CUSTOM",
        version: `disputes-${RUN}`,
        source: "integration test",
        sourceRefs: ["hanziquest-authored"],
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      // Same reading and gloss as the starter curriculum for 人 (a shared character).
      characters: {
        人: { pinyin: "rén", meaning: "person" },
        大: { pinyin: "dà", meaning: "big" },
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
                  simplified: "人",
                  pinyin: "rén",
                  meaning: "person; people",
                  partOfSpeech: "noun",
                },
                { simplified: "大", pinyin: "dà", meaning: "big" },
              ],
            },
          ],
        },
      ],
    },
    loadStrokeData,
  );
  expect(v.ok, JSON.stringify(v.issues)).toBe(true);
  const { curriculumId } = await importCurriculumContent(prisma, v.content!, {
    publishNewLessons: true,
    lookupStrokes: loadStrokeData,
  });
  const person = await prisma.character.findUniqueOrThrow({ where: { hanzi: "人" } });
  exerciseId = (
    await prisma.exercise.findFirstOrThrow({
      where: { curriculumId, type: "FREEHAND_WRITING", characterId: person.id },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("submitting a dispute", () => {
  it("records a structured dispute and changes nothing about grading or progress", async () => {
    const me = await learner("disputer");
    const wrong = await attempt(me.id, "大");
    expect(["NEEDS_IMPROVEMENT", "TRY_AGAIN"]).toContain(wrong.result);
    const before = await progressSnapshot(me.id);
    const dispute = await submitDispute(prisma, me, {
      clientEventId: wrong.clientEventId,
      reason: "CORRECT_MARKED_WRONG",
      consent: true,
    });
    expect(dispute.status).toBe("SUBMITTED");
    const row = await prisma.handwritingDispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(row).toMatchObject({ originalResult: wrong.result, engineVersion: "hq-eval-1" });
    // Decide it, too: still nothing changes.
    const reviewer = await learner("reviewer", ["CURRICULUM_EDITOR"]);
    await claimDispute(prisma, reviewer, dispute.id);
    await decideDispute(prisma, reviewer, dispute.id, { outcome: "GRADING_WRONG" });
    expect(await progressSnapshot(me.id)).toEqual(before);
    // Audited without ink or identifiers.
    const audits = await prisma.auditLog.findMany({
      where: { entityType: "HandwritingDispute", entityId: dispute.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "handwriting.dispute.submit",
      "handwriting.dispute.claim",
      "handwriting.dispute.decide",
    ]);
    const json = JSON.stringify(audits.map((a) => [a.before, a.after]));
    expect(json).not.toMatch(/points|strokeData|email|@/);
    // The learner sees the finding.
    expect((await learnerDisputes(prisma, me.id))[0]).toMatchObject({
      hanzi: "人",
      status: "RESOLVED",
      outcome: "GRADING_WRONG",
    });
  });

  it("only for the learner's own attempts: anyone else's is simply not found", async () => {
    const owner = await learner("owner");
    const other = await learner("other");
    const a = await attempt(owner.id, "大");
    const body = { clientEventId: a.clientEventId, reason: "CORRECT_MARKED_WRONG", consent: true };
    const foreign = await submitDispute(prisma, other, body).catch((e: unknown) => e);
    const missing = await submitDispute(prisma, other, {
      ...body,
      clientEventId: randomUUID(),
    }).catch((e: unknown) => e);
    expect((foreign as DomainError).code).toBe("not_found");
    // Same answer as for an attempt that doesn't exist: nothing reveals it exists.
    expect((foreign as Error).message).toBe((missing as Error).message);
  });

  it("needs a reason that fits the result, explicit consent, and no extra fields", async () => {
    const me = await learner("strict");
    const wrong = await attempt(me.id, "大");
    const right = await attempt(me.id, "人");
    expect(["EXCELLENT", "GOOD"]).toContain(right.result);
    const base = { clientEventId: wrong.clientEventId, consent: true };
    expect(await code(submitDispute(prisma, me, { ...base, reason: "WRONG_MARKED_CORRECT" }))).toBe(
      "conflict",
    );
    expect(
      await code(
        submitDispute(prisma, me, {
          clientEventId: right.clientEventId,
          consent: true,
          reason: "WRONG_MARKED_CORRECT",
        }),
      ),
    ).toBe("ok");
    expect(
      await code(submitDispute(prisma, me, { ...base, consent: false, reason: "INPUT_PROBLEM" })),
    ).toBe("ZodError");
    expect(
      await code(
        submitDispute(prisma, me, { ...base, reason: "INPUT_PROBLEM", note: "free text" }),
      ),
    ).toBe("ZodError");
    expect(await code(submitDispute(prisma, me, { ...base, reason: "SOMETHING_ELSE" }))).toBe(
      "ZodError",
    );
  });

  it("within 14 days only", async () => {
    const me = await learner("late");
    const a = await attempt(me.id, "大");
    const later = new Date(Date.now() + 15 * 86_400_000);
    expect(
      await code(
        submitDispute(
          prisma,
          me,
          { clientEventId: a.clientEventId, reason: "INPUT_PROBLEM", consent: true },
          { now: later },
        ),
      ),
    ).toBe("conflict");
  });

  it("once per attempt, also when submitted twice at the same time", async () => {
    const me = await learner("twice");
    const a = await attempt(me.id, "大");
    const body = { clientEventId: a.clientEventId, reason: "INPUT_PROBLEM", consent: true };
    const results = await Promise.allSettled([
      submitDispute(prisma, me, body),
      submitDispute(prisma, me, body),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((refused.reason as Error).message).toMatch(/already disputed/);
    expect(await code(submitDispute(prisma, me, body))).toBe("conflict");
    expect(await prisma.handwritingDispute.count({ where: { userId: me.id } })).toBe(1);
  });
});

describe("reviewing", () => {
  it("needs the permission; the queue carries no learner identifiers", async () => {
    const me = await learner("queued");
    const a = await attempt(me.id, "大");
    await submitDispute(prisma, me, {
      clientEventId: a.clientEventId,
      reason: "CORRECT_MARKED_WRONG",
      consent: true,
    });
    for (const roles of [["LEARNER"], ["CONTENT_REVIEWER"], ["ANALYST"]] as const)
      expect(await code(disputeQueue(prisma, { id: me.id, roles: [...roles] }))).toBe("forbidden");
    const reviewer = await learner("q-reviewer", ["CURRICULUM_EDITOR"]);
    const queue = await disputeQueue(prisma, reviewer);
    const json = JSON.stringify(queue);
    expect(json).not.toContain(me.id);
    expect(json).not.toMatch(/userId|email|reviewerId|@hanziquest/);
    const item = queue.find((q) => q.characters.join("") === "人" && q.status === "SUBMITTED")!;
    expect(item.ink[0]!.length).toBeGreaterThan(0);
    expect(item.evaluation[0]).toMatchObject({ band: expect.any(String) });
  });

  it("nobody reviews their own dispute, Super Admins included", async () => {
    const admin = await learner("self-admin", ["SUPER_ADMIN"]);
    const a = await attempt(admin.id, "大");
    const d = await submitDispute(prisma, admin, {
      clientEventId: a.clientEventId,
      reason: "CORRECT_MARKED_WRONG",
      consent: true,
    });
    expect(await code(claimDispute(prisma, admin, d.id))).toBe("forbidden");
    expect((await disputeQueue(prisma, admin)).find((q) => q.id === d.id)!.ownDispute).toBe(true);
  });

  it("one claim wins under concurrency; only the claimer decides; decided stays decided", async () => {
    const me = await learner("contested");
    const a = await attempt(me.id, "大");
    const d = await submitDispute(prisma, me, {
      clientEventId: a.clientEventId,
      reason: "CORRECT_MARKED_WRONG",
      consent: true,
    });
    const r1 = await learner("r1", ["CURRICULUM_EDITOR"]);
    const r2 = await learner("r2", ["SUPER_ADMIN"]);
    const claims = await Promise.allSettled([
      claimDispute(prisma, r1, d.id),
      claimDispute(prisma, r2, d.id),
    ]);
    expect(claims.filter((c) => c.status === "fulfilled")).toHaveLength(1);
    const winner = claims[0]!.status === "fulfilled" ? r1 : r2;
    const loser = winner === r1 ? r2 : r1;
    expect(await code(decideDispute(prisma, loser, d.id, { outcome: "GRADING_CORRECT" }))).toBe(
      "conflict",
    );
    expect(await code(releaseDispute(prisma, loser, d.id))).toBe("conflict");
    await releaseDispute(prisma, winner, d.id);
    await claimDispute(prisma, loser, d.id);
    await decideDispute(prisma, loser, d.id, { outcome: "NOT_ASSESSABLE" });
    expect(
      await prisma.handwritingDispute.findUniqueOrThrow({ where: { id: d.id } }),
    ).toMatchObject({
      status: "DISMISSED",
      outcome: "NOT_ASSESSABLE",
      reviewerRole: loser === r1 ? "CURRICULUM_EDITOR" : "SUPER_ADMIN",
    });
    expect(await code(decideDispute(prisma, loser, d.id, { outcome: "GRADING_WRONG" }))).toBe(
      "conflict",
    );
    expect(await code(decideDispute(prisma, loser, d.id, { outcome: "PROMOTE_TO_MASTERED" }))).toBe(
      "ZodError",
    );
  });
});

describe("claims can't get stuck", () => {
  it("a deleted reviewer's claim, or one idle for a week, can be taken over; a fresh one can't", async () => {
    const me = await learner("stuck");
    const r1 = await learner("stuck-r1", ["CURRICULUM_EDITOR"]);
    const r2 = await learner("stuck-r2", ["CURRICULUM_EDITOR"]);
    const r3 = await learner("stuck-r3", ["CURRICULUM_EDITOR"]);
    const submit = async () => {
      const a = await attempt(me.id, "大");
      return submitDispute(prisma, me, {
        clientEventId: a.clientEventId,
        reason: "CORRECT_MARKED_WRONG",
        consent: true,
      });
    };
    // A fresh claim belongs to its reviewer.
    const fresh = await submit();
    await claimDispute(prisma, r1, fresh.id);
    expect(await code(claimDispute(prisma, r2, fresh.id))).toBe("conflict");
    // Idle for 8 days: another reviewer may take it over.
    const idle = await submit();
    await claimDispute(prisma, r1, idle.id, { now: new Date(Date.now() - 8 * 86_400_000) });
    await claimDispute(prisma, r2, idle.id);
    expect(
      (await prisma.handwritingDispute.findUniqueOrThrow({ where: { id: idle.id } })).reviewerId,
    ).toBe(r2.id);
    // The claiming reviewer's account was deleted: the claim is free again.
    const orphan = await submit();
    await claimDispute(prisma, r3, orphan.id);
    await deleteAccount(prisma, r3.id, { password: PASSWORD, confirm: "DELETE" });
    expect(
      (await prisma.handwritingDispute.findUniqueOrThrow({ where: { id: orphan.id } })).status,
    ).toBe("UNDER_REVIEW");
    await claimDispute(prisma, r2, orphan.id);
    await decideDispute(prisma, r2, orphan.id, { outcome: "GRADING_CORRECT" });
    expect(
      (await prisma.handwritingDispute.findUniqueOrThrow({ where: { id: orphan.id } })).status,
    ).toBe("RESOLVED");
  });
});

describe("account deletion", () => {
  it("removes the learner's disputes; a deleted reviewer's decisions stay", async () => {
    const me = await learner("leaving");
    const a = await attempt(me.id, "大");
    const d = await submitDispute(prisma, me, {
      clientEventId: a.clientEventId,
      reason: "INPUT_PROBLEM",
      consent: true,
    });
    const reviewer = await learner("leaving-reviewer", ["CURRICULUM_EDITOR"]);
    await claimDispute(prisma, reviewer, d.id);
    await decideDispute(prisma, reviewer, d.id, { outcome: "GRADING_CORRECT" });
    await deleteAccount(prisma, reviewer.id, { password: PASSWORD, confirm: "DELETE" });
    expect(
      await prisma.handwritingDispute.findUniqueOrThrow({ where: { id: d.id } }),
    ).toMatchObject({
      reviewerId: null,
      reviewerRole: "CURRICULUM_EDITOR",
      outcome: "GRADING_CORRECT",
    });
    await deleteAccount(prisma, me.id, { password: PASSWORD, confirm: "DELETE" });
    expect(await prisma.handwritingDispute.findUnique({ where: { id: d.id } })).toBeNull();
    const audits = await prisma.auditLog.findMany({ where: { entityId: d.id } });
    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(audits.every((x) => x.actorId === null)).toBe(true);
  });
});
