/**
 * M13 replay harness against a real database: historical evaluations preserved, strict
 * isolation (no table changes), determinism, malformed input, duplicate submissions, and the
 * participant-level split of lab samples. Synthetic ink and TEST participant codes only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { submitAttempt } from "@/features/exercises/attempts";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import { toInk } from "@/features/handwriting/synthetic-ink";
import { recordConsent } from "@/features/handwriting/participants";
import { CURRENT_PILOT_CONSENT_VERSION } from "@/features/handwriting/consent";
import { recordSample } from "@/features/handwriting/samples";
import {
  duplicateReport,
  replayStoredAttempts,
  sampleSplit,
  readOnlyClient,
  ReadOnlyViolation,
  splitOf,
} from "@/features/handwriting/replay";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
let userId: string;
let exerciseId: string;
const attemptIds: string[] = [];

const ink = (hanzi: string, seed: number) =>
  toInk(fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians).medians, { seed });

const writing = (hanzi: string, seed: number, clientEventId = randomUUID()) => ({
  clientEventId,
  exerciseId,
  occurredAt: new Date().toISOString(),
  kind: "writing" as const,
  drawings: [ink(hanzi, seed)],
});

/** Every table replay must never touch, for this learner where it applies. */
async function snapshot() {
  const mine = { userId };
  const [
    attempts,
    results,
    xp,
    mastery,
    schedules,
    daily,
    sync,
    samples,
    consents,
    participants,
    audit,
  ] = await Promise.all([
    prisma.exerciseAttempt.findMany({
      where: mine,
      orderBy: { id: "asc" },
      select: {
        id: true,
        clientEventId: true,
        result: true,
        score: true,
        evaluation: true,
        strokeData: true,
        xpAwarded: true,
        mode: true,
      },
    }),
    prisma.attemptCharacterResult.findMany({ where: mine, orderBy: { attemptId: "asc" } }),
    prisma.xPTransaction.findMany({ where: mine, orderBy: { id: "asc" } }),
    prisma.characterMastery.findMany({ where: mine, orderBy: { characterId: "asc" } }),
    prisma.reviewSchedule.findMany({ where: mine, orderBy: { characterId: "asc" } }),
    prisma.dailyActivity.findMany({ where: mine }),
    prisma.syncEvent.count(),
    prisma.handwritingSample.count(),
    prisma.pilotConsent.count(),
    prisma.pilotParticipant.count(),
    prisma.auditLog.count(),
  ]);
  return JSON.stringify({
    attempts,
    results,
    xp,
    mastery,
    schedules,
    daily,
    sync,
    samples,
    consents,
    participants,
    audit,
  });
}

beforeAll(async () => {
  await ensureRoles(prisma);
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `replay-${RUN}`,
        name: "Replay IT",
        framework: "CUSTOM",
        version: `replay-${RUN}`,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: {
        我: { pinyin: "wǒ", meaning: "I" },
        他: { pinyin: "tā", meaning: "he" },
      },
      units: [
        {
          slug: "u1",
          title: "U1",
          lessons: [
            {
              slug: "l1",
              title: "L1",
              words: [
                { simplified: "我", pinyin: "wǒ", meaning: "I" },
                { simplified: "他", pinyin: "tā", meaning: "he" },
              ],
            },
          ],
        },
      ],
    },
    loadStrokeData,
  );
  expect(content.ok).toBe(true);
  const summary = await importCurriculumContent(prisma, content.content!, {
    publishNewLessons: true,
    lookupStrokes: loadStrokeData,
  });
  const exercise = await prisma.exercise.findFirstOrThrow({
    where: {
      curriculumId: summary.curriculumId,
      type: "FREEHAND_WRITING",
      character: { hanzi: "我" },
    },
  });
  exerciseId = exercise.id;
  const r = await registerUser(prisma, {
    displayName: "Replay",
    email: uniqueEmail("replay"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  userId = r.userId;

  // A correct attempt, a repeated attempt (a wrong character), and a re-sent duplicate.
  const first = writing("我", 1);
  const a = await submitAttempt(prisma, userId, first);
  const b = await submitAttempt(prisma, userId, writing("他", 2));
  attemptIds.push(a.attemptId, b.attemptId);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("duplicate submissions and repeated attempts", () => {
  it("a re-sent attempt is stored once and changes no progress", async () => {
    const stored = await prisma.exerciseAttempt.findUniqueOrThrow({
      where: { id: attemptIds[0]! },
    });
    const before = await snapshot();
    const again = await submitAttempt(prisma, userId, {
      clientEventId: stored.clientEventId,
      exerciseId,
      occurredAt: stored.occurredAt.toISOString(),
      kind: "writing",
      drawings: [ink("我", 99)], // different ink under the same id: ignored
    });
    expect(again.duplicate).toBe(true);
    expect(again.attemptId).toBe(stored.id);
    expect(await snapshot()).toBe(before);
    expect((await duplicateReport(prisma)).duplicateClientEventIds).toBe(0);
  });
});

describe("replay of stored attempts", () => {
  it("reproduces every stored evaluation, deterministically, and changes nothing", async () => {
    const before = await snapshot();
    const r1 = await replayStoredAttempts(prisma, { attemptIds });
    const r2 = await replayStoredAttempts(prisma, { attemptIds });
    expect(r1.attempts).toBe(2);
    expect(r1).toMatchObject({ eligible: 2, truncated: false });
    // A limit that cuts the replay short says so (review R2).
    const cut = await replayStoredAttempts(prisma, { attemptIds, limit: 1 });
    expect(cut).toMatchObject({ attempts: 1, eligible: 2, truncated: true });
    expect(r1.byStatus.identical).toBe(2);
    expect(r1.nondeterministic).toBe(0);
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
    // The repeated attempt (他 written for 我) replays to the same rejection.
    const wrong = r1.results.find((x) => x.attemptId === attemptIds[1])!;
    expect(wrong.original.band).toBe("TRY_AGAIN");
    expect(wrong.replayed.band).toBe("TRY_AGAIN");
    // Historical evaluations, XP, mastery, schedules, sync, consent, samples, audit: untouched.
    expect(await snapshot()).toBe(before);
  });

  it("reports malformed stored input instead of failing, and still writes nothing", async () => {
    const good = await prisma.exerciseAttempt.findUniqueOrThrow({ where: { id: attemptIds[0]! } });
    const bad = await prisma.exerciseAttempt.create({
      data: {
        clientEventId: randomUUID(),
        userId,
        exerciseId,
        curriculumId: good.curriculumId,
        mode: "INDEPENDENT",
        result: "GOOD",
        strokeData: [[{ notPoints: true }]],
        evaluation: good.evaluation ?? undefined,
        occurredAt: new Date(),
      },
    });
    try {
      const before = await snapshot();
      const r = await replayStoredAttempts(prisma, { attemptIds: [bad.id] });
      expect(r.results[0]).toMatchObject({ status: "invalid-input" });
      expect(await snapshot()).toBe(before);
    } finally {
      await prisma.exerciseAttempt.delete({ where: { id: bad.id } });
    }
  });
});

describe("read-only client against the real Prisma client (review R1, R4)", () => {
  it("no write path is reachable: models, raw, transactions, $extends, internals, symbols", async () => {
    const before = await snapshot();
    const db = readOnlyClient(prisma) as unknown as Record<string | symbol, unknown>;
    const attempts: (() => unknown)[] = [];
    const model = db.exerciseAttempt as Record<string, (...a: unknown[]) => unknown>;
    for (const m of [
      "create",
      "createMany",
      "update",
      "updateMany",
      "upsert",
      "delete",
      "deleteMany",
    ])
      attempts.push(() => model[m]!({ where: { id: "none" }, data: {} }));
    for (const m of [
      "$executeRaw",
      "$executeRawUnsafe",
      "$queryRawUnsafe",
      "$transaction",
      "$extends",
    ])
      attempts.push(() => (db[m] as (...a: unknown[]) => unknown)("SELECT 1"));
    // Prisma's internal client, under `_originalClient` and under an unnamed symbol.
    const internals: unknown[] = [db._originalClient];
    for (const s of Object.getOwnPropertySymbols(prisma)) internals.push(db[s]);
    for (const obj of internals) {
      if (!obj || typeof obj !== "object") continue;
      const o = obj as Record<string, unknown>;
      const inner = (o._originalClient ?? o) as Record<string, unknown>;
      const delegate = inner.exerciseAttempt as Record<string, () => unknown> | undefined;
      if (delegate) attempts.push(() => delegate.create!());
      if (typeof inner.$executeRawUnsafe === "function")
        attempts.push(() => (inner.$executeRawUnsafe as () => unknown)());
    }
    expect(attempts.length).toBeGreaterThan(12);
    for (const call of attempts) expect(call).toThrow(ReadOnlyViolation);
    await expect(
      (db.exerciseAttempt as { count: () => Promise<number> }).count(),
    ).resolves.toBeGreaterThan(0);
    expect(await snapshot()).toBe(before);
  });
});

describe("held-out split of lab samples", () => {
  it("splits by participant (no writer in both sets), reproduces the lab metrics, and says it's insufficient", async () => {
    const actor = { id: userId, roles: ["CURRICULUM_EDITOR"] as const };
    const codes = [0, 1, 2, 3, 4, 5].map((i) => `TESTRP${RUN.slice(-6)}${i}`.slice(0, 16));
    for (const [i, code] of codes.entries()) {
      await recordConsent(prisma, actor, {
        participantCode: code,
        version: CURRENT_PILOT_CONSENT_VERSION,
        acceptedAt: new Date().toISOString(),
        witnessed: true,
      });
      await recordSample(prisma, actor, {
        participantCode: code,
        hanzi: "我",
        category: "CORRECT",
        style: "normal",
        inputDevice: "mouse",
        strokes: ink("我", 10 + i),
        consentConfirmed: true,
      });
    }
    const before = await snapshot();
    const s = await sampleSplit(prisma, { includeTests: true });
    expect(s.writerOverlap).toBe(0);
    expect(s.reproducesLabMetrics).toBe(true);
    expect(s.sufficientForValidation).toBe(false);
    expect(s.insufficientBecause.join(" ")).toMatch(/TEST rehearsal or automated samples/);
    expect(s.development.samples + s.heldOut.samples).toBe(s.total);
    expect(s.stored).toBe(s.total); // nothing truncated (review R3)
    // Every code lands in exactly one split.
    for (const c of codes) expect(["development", "held-out"]).toContain(splitOf(c));
    // Human-only view excludes TEST codes entirely.
    const human = await sampleSplit(prisma);
    expect(human.source).toMatch(/TEST codes excluded/);
    expect(JSON.stringify(human)).not.toContain("TESTRP");
    expect(JSON.stringify(s)).not.toContain("TESTRP"); // counts only, never codes
    expect(await snapshot()).toBe(before);
  });
});
