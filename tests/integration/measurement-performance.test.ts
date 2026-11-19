/**
 * M15-a performance on SYNTHETIC data: 1,000 learners and 100,000 attempts in one signup-week
 * cohort (10 characters × 10 attempts each, over about two months). Not real learners.
 * Prints the timings; fails only past a generous budget (a regression guard, not a benchmark).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureCohort } from "@/features/measurement/engine";
import { ensureRoles, testPrisma } from "./helpers";
import { measurementCurriculum, type MeasurementFixture } from "./measurement-fixtures";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const LEARNERS = 1000;
const CHARS = 10;
const PER_CHAR = 10;
const WEEK = "2026-W30"; // Mon 2026-07-20
const START = new Date("2026-07-20T08:00:00Z");
const NOW = new Date("2026-11-19T12:00:00Z");
let fx: MeasurementFixture;
let insertMs = 0;

beforeAll(async () => {
  await ensureRoles(prisma);
  // Earlier runs' synthetic learners share this fixed week: remove them first (test data only;
  // their learning data cascades).
  await prisma.user.deleteMany({
    where: { email: { startsWith: "m15-perf-", endsWith: "@measure.example" } },
  });
  fx = await measurementCurriculum(prisma, `m15-perf-${RUN}`, CHARS, 0x4d40);
  const t = performance.now();
  // Set-based inserts (test database only): the same synthetic shape, in seconds.
  const prefix = `m15perf${RUN}`;
  await prisma.$executeRaw`
    INSERT INTO "User" (id, email, "createdAt", "updatedAt")
    SELECT ${prefix} || g, ${`m15-perf-${RUN}-`} || g || '@measure.example',
           ${START}::timestamp + (g % 7) * interval '1 day' + (g % 13) * interval '1 hour', now()
      FROM generate_series(0, ${LEARNERS - 1}) g`;
  await prisma.$executeRaw`
    INSERT INTO "Profile" (id, "userId", "displayName", timezone, "updatedAt")
    SELECT 'p' || id, id, 'Synthetic', 'UTC', now() FROM "User" WHERE id LIKE ${prefix + "%"}`;
  await prisma.$executeRaw`
    INSERT INTO "ExerciseAttempt"
      (id, "clientEventId", "userId", "exerciseId", "characterId", "curriculumId", mode, result, "occurredAt")
    SELECT a.id, a.id, a.uid, ${fx.exerciseId}, a.cid, ${fx.curriculumId}, 'INDEPENDENT'::"PracticeMode",
           (ARRAY['EXCELLENT','GOOD','GOOD','NEEDS_IMPROVEMENT','TRY_AGAIN'])[1 + (a.k + a.ord + a.n) % 5]::"AttemptResult",
           a.created + a.ord * interval '1 hour' + (a.k + 1) * (1 + ((a.k * 7 + a.ord) % 9)) * interval '14 hours'
      FROM (
        SELECT md5(u.id || c.cid || k) AS id, u.id AS uid, u."createdAt" AS created, c.cid, c.ord::int AS ord, k,
               substring(u.id from ${prefix.length + 1}::int)::int AS n
          FROM "User" u
          CROSS JOIN unnest(${fx.characterIds}::text[]) WITH ORDINALITY AS c(cid, ord)
          CROSS JOIN generate_series(0, ${PER_CHAR - 1}) k
         WHERE u.id LIKE ${prefix + "%"}
      ) a`;
  await prisma.$executeRaw`
    INSERT INTO "AttemptCharacterResult" ("attemptId", position, "userId", "characterId", mode, result, "occurredAt")
    SELECT id, 0, "userId", "characterId", mode, result, "occurredAt"
      FROM "ExerciseAttempt" WHERE "userId" LIKE ${prefix + "%"}`;
  await prisma.$executeRaw`
    INSERT INTO "DailyActivity" ("userId", date, "exercisesCompleted", "updatedAt")
    SELECT u.id, (u."createdAt" + d * interval '1 day')::date, 2, now()
      FROM "User" u CROSS JOIN unnest(ARRAY[1, 7, 30]) d
     WHERE u.id LIKE ${prefix + "%"}
       AND (substring(u.id from ${prefix.length + 1}::int)::int + d) % 3 <> 0`;
  insertMs = performance.now() - t;
}, 300_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("performance (synthetic: 1,000 learners, 100,000 attempts)", () => {
  it("measures the cohort within budget, read-only, with aggregates only", async () => {
    expect(
      await prisma.attemptCharacterResult.count({
        where: {
          user: { email: { endsWith: `@measure.example` }, id: { startsWith: `m15perf${RUN}` } },
        },
      }),
    ).toBe(LEARNERS * CHARS * PER_CHAR);
    global.gc?.();
    const heap0 = process.memoryUsage().heapUsed;
    const t = performance.now();
    const { metrics } = await measureCohort(prisma, WEEK, { now: NOW });
    const ms = performance.now() - t;
    const heapMB = Math.round((process.memoryUsage().heapUsed - heap0) / 1024 / 1024);
    console.log(
      `[m15-perf] synthetic insert ${Math.round(insertMs)} ms; measureCohort ${Math.round(ms)} ms; heap delta ${heapMB} MB; learners ${metrics.learners}`,
    );
    expect(metrics.learners).toBe(LEARNERS);
    const dueReviews = metrics.recallByInterval.reduce((s, b) => s + b.recall.n, 0);
    expect(dueReviews).toBeGreaterThan(0);
    expect(metrics.lapseRate.contributors).toBe(LEARNERS);
    // Budget: generous, to catch regressions (an N+1 or a quadratic step), not to benchmark.
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
});
