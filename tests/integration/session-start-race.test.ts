/**
 * Concurrent lesson starts. Two requests to start the same lesson for the first time (React's
 * development double-mount, two tabs, or two overlapping offline-sync uploads) raced on the
 * LessonProgress row. The read-then-insert `upsert` let both insert, and one request failed with
 * a unique-constraint error (500), rolling back its session.
 *
 * Learning behaviour is unchanged: each start still creates its own session, and a lesson that
 * is already in progress, completed or tested out keeps its status.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { startLessonSession } from "@/features/learning/sessions";
import { processSyncBatch } from "@/features/offline/sync-service";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
let firstLesson = "";

beforeAll(async () => {
  await ensureRoles(prisma);
  const tag = randomUUID().slice(0, 8);
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `race-${tag}`,
        name: "Race IT",
        framework: "CUSTOM",
        version: `race-${tag}`,
        source: "integration test",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters: { 你: { pinyin: "nǐ", meaning: "you" }, 好: { pinyin: "hǎo", meaning: "good" } },
      units: [
        {
          slug: "u1",
          title: "U1",
          lessons: [
            {
              slug: "l1",
              title: "L1",
              words: [{ simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello" }],
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
  const lesson = await prisma.lesson.findFirstOrThrow({
    where: { unit: { level: { curriculumId: summary.curriculumId } } },
    orderBy: { position: "asc" },
  });
  firstLesson = lesson.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function newLearner() {
  const r = await registerUser(prisma, {
    displayName: "Racer",
    email: uniqueEmail("race"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

describe("starting a lesson concurrently", () => {
  it("never fails: every concurrent first start gets a session; one progress row", async () => {
    for (let round = 0; round < 5; round += 1) {
      const learner = await newLearner();
      const starts = await Promise.allSettled(
        Array.from({ length: 6 }, () => startLessonSession(prisma, learner, firstLesson)),
      );
      const failures = starts.filter((s) => s.status === "rejected");
      expect(failures.map((f) => String((f as PromiseRejectedResult).reason))).toEqual([]);
      const ids = starts.map((s) => (s as PromiseFulfilledResult<{ id: string }>).value.id);
      expect(new Set(ids).size).toBe(6);
      expect(
        await prisma.learningSession.count({ where: { userId: learner, lessonId: firstLesson } }),
      ).toBe(6);
      const rows = await prisma.lessonProgress.findMany({ where: { userId: learner } });
      expect(rows.map((r) => [r.lessonId, r.status])).toEqual([[firstLesson, "IN_PROGRESS"]]);
    }
  });

  it("is idempotent for progress: repeating a start changes nothing", async () => {
    const learner = await newLearner();
    await startLessonSession(prisma, learner, firstLesson);
    const before = await prisma.lessonProgress.findUniqueOrThrow({
      where: { userId_lessonId: { userId: learner, lessonId: firstLesson } },
    });
    await startLessonSession(prisma, learner, firstLesson);
    const after = await prisma.lessonProgress.findUniqueOrThrow({
      where: { userId_lessonId: { userId: learner, lessonId: firstLesson } },
    });
    expect(after).toEqual(before);
  });

  it("never downgrades a completed or tested-out lesson", async () => {
    for (const status of ["COMPLETED", "TESTED_OUT"] as const) {
      const learner = await newLearner();
      const completedAt = new Date("2026-11-01T10:00:00Z");
      await prisma.lessonProgress.create({
        data: { userId: learner, lessonId: firstLesson, status, completedAt },
      });
      await Promise.all([
        startLessonSession(prisma, learner, firstLesson),
        startLessonSession(prisma, learner, firstLesson),
      ]);
      const row = await prisma.lessonProgress.findUniqueOrThrow({
        where: { userId_lessonId: { userId: learner, lessonId: firstLesson } },
      });
      expect([row.status, row.completedAt?.toISOString()]).toEqual([
        status,
        completedAt.toISOString(),
      ]);
    }
  });
});

describe("overlapping offline-sync uploads", () => {
  it("two uploads from a new device both finish; no batch fails", async () => {
    const learner = await newLearner();
    const deviceId = randomUUID();
    const batch = () => ({
      deviceId,
      events: [
        {
          id: randomUUID(),
          type: "lesson.complete" as const,
          clientCreatedAt: new Date().toISOString(),
          payload: { lessonId: firstLesson, attemptIds: [] },
        },
      ],
    });
    // The same queue uploaded twice at once (two tabs, or a retry racing a slow request).
    const uploads = await Promise.allSettled([
      processSyncBatch(prisma, learner, batch()),
      processSyncBatch(prisma, learner, batch()),
    ]);
    expect(uploads.filter((u) => u.status === "rejected")).toEqual([]);
    for (const u of uploads) {
      const { results } = (
        u as PromiseFulfilledResult<Awaited<ReturnType<typeof processSyncBatch>>>
      ).value;
      // No attempts were made, so completion is refused as a normal (domain) rejection.
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ status: "rejected" });
      expect(results[0]!.error).toMatch(/still to do/);
    }
    expect(await prisma.device.count({ where: { userId: learner, clientId: deviceId } })).toBe(1);
    expect(await prisma.lessonProgress.count({ where: { userId: learner } })).toBe(1);
  });
});
