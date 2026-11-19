/**
 * M15-a learning measurement on the local test database, with SYNTHETIC learners.
 * - Known values for one signup-week cohort, and who is excluded (staff, test accounts,
 *   deleted accounts, other weeks). Suspended accounts are counted.
 * - The observer never changes replay: stored mastery and schedules (written by the real
 *   `recomputeCharacter`) equal a replay with the observer.
 * - Measuring writes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureCohort } from "@/features/measurement/engine";
import { recomputeCharacter } from "@/features/progress/record";
import { replayCharacter, type ReplayStep } from "@/features/progress/mastery";
import { ensureRoles, testPrisma } from "./helpers";
import {
  measurementCurriculum,
  syntheticAttempts,
  syntheticLearner,
  type MeasurementFixture,
} from "./measurement-fixtures";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const DAY = 86_400_000;
const WEEK = "2026-W40"; // Mon 2026-09-28 to Mon 2026-10-05
const NOW = new Date("2026-11-19T12:00:00Z");
const monday = new Date("2026-09-28T10:00:00Z");
const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY);
const email = (who: string) => `m15-${who}-${RUN}@measure.example`;
let fx: MeasurementFixture;

beforeAll(async () => {
  await ensureRoles(prisma);
  // Earlier runs' synthetic learners share these fixed weeks: remove them first (test data
  // only; their learning data cascades). The performance test cleans up its own.
  await prisma.user.deleteMany({
    where: {
      email: { startsWith: "m15-", endsWith: "@measure.example" },
      NOT: { email: { startsWith: "m15-perf-" } },
    },
  });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "m15-tester-", endsWith: "@hanziquest.test" } },
  });
  fx = await measurementCurriculum(prisma, `m15-${RUN}`, 4, 0x4d20);

  // A: activated (lesson 2 h after signing up), returned on D1 and D7, three good recalls.
  const a = await syntheticLearner(prisma, {
    email: email("a"),
    createdAt: monday,
    onboardedAt: at(monday, 0.01),
  });
  await prisma.lessonProgress.create({
    data: {
      userId: a,
      lessonId: fx.lessonId,
      status: "COMPLETED",
      startedAt: at(monday, 1 / 24),
      completedAt: at(monday, 2 / 24),
    },
  });
  await prisma.dailyActivity.createMany({
    data: [
      { userId: a, date: new Date("2026-09-29"), exercisesCompleted: 3 },
      { userId: a, date: new Date("2026-10-05"), exercisesCompleted: 2 },
    ],
  });
  await syntheticAttempts(prisma, fx, a, [
    { characterId: fx.characterIds[0]!, occurredAt: monday, result: "GOOD" },
    { characterId: fx.characterIds[0]!, occurredAt: at(monday, 1), result: "GOOD" },
    { characterId: fx.characterIds[0]!, occurredAt: at(monday, 4), result: "EXCELLENT" },
  ]);
  // B: signed up, did nothing.
  await syntheticLearner(prisma, { email: email("b"), createdAt: at(monday, 2) });
  // C: suspended, did nothing. Still counted: suspension mustn't change who is measured.
  await syntheticLearner(prisma, {
    email: email("suspended"),
    createdAt: at(monday, 3),
    status: "SUSPENDED",
  });

  // Excluded, each with activity that would change the results if counted.
  const excluded = [
    await syntheticLearner(prisma, {
      email: email("staff"),
      createdAt: monday,
      roles: ["LEARNER", "CURRICULUM_EDITOR"],
    }),
    await syntheticLearner(prisma, {
      email: `m15-tester-${RUN}@hanziquest.test`,
      createdAt: monday,
    }),
    await syntheticLearner(prisma, {
      email: email("deleted"),
      createdAt: monday,
      status: "DELETED",
    }),
    await syntheticLearner(prisma, { email: email("nextweek"), createdAt: at(monday, 7) }),
  ];
  for (const id of excluded) {
    await prisma.lessonProgress.create({
      data: {
        userId: id,
        lessonId: fx.lessonId,
        status: "COMPLETED",
        completedAt: at(monday, 0.1),
      },
    });
    await syntheticAttempts(prisma, fx, id, [
      { characterId: fx.characterIds[1]!, occurredAt: monday, result: "GOOD" },
      { characterId: fx.characterIds[1]!, occurredAt: at(monday, 1), result: "TRY_AGAIN" },
    ]);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a signup-week cohort (synthetic)", () => {
  it("counts only measured learners, with known values", async () => {
    const { metrics: m, week, asOf } = await measureCohort(prisma, WEEK, { now: NOW });
    expect(week).toBe(WEEK);
    expect(asOf).toEqual(NOW);
    expect(m.learners).toBe(3);
    expect(m.activation).toMatchObject({ successes: 1, n: 3, contributors: 3 });
    expect(m.returns.d1).toMatchObject({ successes: 1, n: 3 });
    expect(m.returns.d7).toMatchObject({ successes: 1, n: 3 });
    expect(m.returns.d30).toMatchObject({ successes: 0, n: 3 });
    const bucket = (k: string) => m.recallByInterval.find((b) => b.bucket === k)!.recall;
    expect(bucket("1")).toMatchObject({ successes: 1, n: 1, contributors: 1 });
    expect(bucket("2-3")).toMatchObject({ successes: 1, n: 1, contributors: 1 });
    // No lapses: the excluded learners' failure isn't counted.
    expect(m.lapseRate).toMatchObject({ successes: 0, n: 2, contributors: 1 });
    // Onboarding funnel: A finished onboarding, started and completed a lesson and wrote due
    // reviews; B and C did nothing; nobody started a placement check.
    const stage = (s: string) => m.funnel.find((f) => f.stage === s)!.reached;
    expect(stage("onboarded")).toMatchObject({ successes: 1, n: 3 });
    expect(stage("placementStarted")).toMatchObject({ successes: 0, n: 3 });
    expect(stage("lessonStarted")).toMatchObject({ successes: 1, n: 3 });
    expect(stage("lessonCompleted")).toMatchObject({ successes: 1, n: 3 });
    expect(stage("dueReviewWritten")).toMatchObject({ successes: 1, n: 3 });
    expect(m.activation.interval![0]).toBeGreaterThan(0);
    expect(m.activation.interval![1]).toBeLessThan(1);
  });

  it("refuses anything but a real week", async () => {
    await expect(measureCohort(prisma, "2026-09-28", { now: NOW })).rejects.toThrow(
      /Not a cohort week/,
    );
  });

  it("an empty week returns zero learners and no rates", async () => {
    const { metrics } = await measureCohort(prisma, "2019-W10", { now: NOW });
    expect(metrics.learners).toBe(0);
    expect(metrics.activation).toMatchObject({ n: 0, rate: null, interval: null });
  });
});

describe("differencing", () => {
  it("suspending a learner changes no cohort figure", async () => {
    const before = await measureCohort(prisma, WEEK, { now: NOW });
    const a = await prisma.user.findFirstOrThrow({ where: { email: email("a") } });
    await prisma.user.update({ where: { id: a.id }, data: { status: "SUSPENDED" } });
    try {
      const after = await measureCohort(prisma, WEEK, { now: NOW });
      expect(after.metrics).toEqual(before.metrics);
    } finally {
      await prisma.user.update({ where: { id: a.id }, data: { status: "ACTIVE" } });
    }
  });
});

describe("the observer never changes replay (stored state)", () => {
  it("stored mastery and schedules equal a replay with the observer", async () => {
    // Real persistence path: recomputeCharacter writes mastery and schedules from replay.
    const learner = await syntheticLearner(prisma, { email: email("identity"), createdAt: monday });
    const results = ["GOOD", "TRY_AGAIN", "EXCELLENT", "NEEDS_IMPROVEMENT", "GOOD"] as const;
    for (const [i, characterId] of fx.characterIds.entries())
      await syntheticAttempts(
        prisma,
        fx,
        learner,
        Array.from({ length: 6 + i }, (_, j) => ({
          characterId,
          occurredAt: at(monday, j * (1 + i) + (j % 2) * 0.3),
          mode: j % 4 === 3 ? ("GUIDED" as const) : ("INDEPENDENT" as const),
          result: results[(i + j) % results.length]!,
          techniqueOk: j % 3 === 0 ? false : true,
        })),
      );
    for (const characterId of fx.characterIds)
      await prisma.$transaction((tx) => recomputeCharacter(tx, learner, characterId));

    const stored = await prisma.reviewSchedule.findMany({ where: { userId: learner } });
    const mastery = await prisma.characterMastery.findMany({ where: { userId: learner } });
    expect(stored).toHaveLength(fx.characterIds.length);
    for (const s of stored) {
      const events = await prisma.attemptCharacterResult.findMany({
        where: { userId: learner, characterId: s.characterId },
        select: { occurredAt: true, mode: true, result: true, techniqueOk: true },
      });
      const steps: ReplayStep[] = [];
      const replay = replayCharacter(events, (step) => steps.push(step))!;
      expect(steps.length).toBeGreaterThan(0);
      expect(replay.review).toMatchObject({
        dueAt: s.dueAt,
        intervalDays: s.intervalDays,
        easeFactor: s.easeFactor,
        repetitions: s.repetitions,
        lapses: s.lapses,
      });
      const m = mastery.find((x) => x.characterId === s.characterId)!;
      expect(replay.mastery.level).toBe(m.level);
      expect(replay.mastery.strength).toBe(m.strength);
      expect(steps.at(-1)!.levelAfter).toBe(m.level);
    }
  });
});

describe("measurement writes nothing", () => {
  it("leaves every learning table exactly as it was", async () => {
    const snapshot = async () =>
      Promise.all([
        prisma.exerciseAttempt.count(),
        prisma.attemptCharacterResult.count(),
        prisma.characterMastery.findMany({ orderBy: [{ userId: "asc" }, { characterId: "asc" }] }),
        prisma.reviewSchedule.findMany({ orderBy: { id: "asc" } }),
        prisma.dailyActivity.findMany({ orderBy: [{ userId: "asc" }, { date: "asc" }] }),
        prisma.streak.findMany({ orderBy: { userId: "asc" } }),
        prisma.lessonProgress.findMany({ orderBy: [{ userId: "asc" }, { lessonId: "asc" }] }),
        prisma.user.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true } }),
        prisma.auditLog.count(),
      ]);
    const before = await snapshot();
    await measureCohort(prisma, WEEK, { now: NOW, batchSize: 1 });
    await measureCohort(prisma, WEEK);
    expect(await snapshot()).toEqual(before);
  });
});
