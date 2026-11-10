import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { importCurriculumContent } from "@/features/curriculum/import-content";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { submitAttempt } from "@/features/exercises/attempts";
import {
  completeLessonSession,
  getDueReviews,
  startLessonSession,
  startReviewSession,
} from "@/features/learning/sessions";
import { processSyncBatch } from "@/features/offline/sync-service";
import { ACHIEVEMENTS } from "@/features/progress/achievements";
import { getProgressSummary } from "@/features/progress/queries";
import { XP } from "@/features/progress/xp-rules";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import type { Prisma } from "@/generated/prisma/client";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const DAY = 86_400_000;

let lesson1: string;
let lesson2: string;

function ink(hanzi: string, seed = 1) {
  return toInk(fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians).medians, { seed });
}

async function newUser(timezone = "UTC") {
  const r = await registerUser(prisma, {
    displayName: "P",
    email: uniqueEmail("progress"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  await prisma.profile.update({
    where: { userId: r.userId },
    data: { timezone, dailyGoalXp: 20, onboardingCompletedAt: new Date() },
  });
  return r.userId;
}

async function exercise(lessonId: string, key: string) {
  const row = await prisma.lessonExercise.findFirstOrThrow({
    where: { lessonId, exercise: { key } },
    include: { exercise: true },
  });
  return row.exercise;
}

function write(exerciseId: string, hanzi: string[], extra: Record<string, unknown> = {}) {
  return {
    clientEventId: randomUUID(),
    exerciseId,
    occurredAt: new Date().toISOString(),
    kind: "writing" as const,
    drawings: hanzi.map((h, i) => ink(h, i + 3)),
    ...extra,
  };
}

beforeAll(async () => {
  await ensureRoles(prisma);
  for (const a of ACHIEVEMENTS) {
    const data = { ...a, criteria: a.criteria as Prisma.InputJsonValue };
    await prisma.achievement.upsert({ where: { key: a.key }, create: data, update: data });
  }
  const content = validateCurriculumContent(
    {
      curriculum: {
        slug: `progress-${RUN}`,
        name: "Progress IT",
        framework: "CUSTOM",
        version: `progress-${RUN}`,
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
            { slug: "l2", title: "L2", words: [{ simplified: "我", pinyin: "wǒ", meaning: "I" }] },
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
  const lessons = await prisma.lesson.findMany({
    where: { unit: { level: { curriculumId: summary.curriculumId } } },
    orderBy: { position: "asc" },
  });
  lesson1 = lessons[0]!.id;
  lesson2 = lessons[1]!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("XP", () => {
  it("is computed on the server and recorded once per attempt", async () => {
    const user = await newUser();
    const ex = await exercise(lesson1, "char:你:freehand");
    const body = write(ex.id, ["你"], { xpAwarded: 9999, score: 100 });
    const first = await submitAttempt(prisma, user, body);
    expect(first.xpAwarded).toBe(XP.attempt[first.result]);
    const again = await submitAttempt(prisma, user, body);
    expect(again.duplicate).toBe(true);
    expect(again.progress).toBeNull();
    const ledger = await prisma.xPTransaction.findMany({ where: { userId: user } });
    expect(ledger.filter((l) => l.reason === "EXERCISE_COMPLETED")).toHaveLength(1);
  });

  it("stops rewarding repeats of the same exercise on the same day", async () => {
    const user = await newUser();
    const ex = await exercise(lesson1, "char:好:freehand");
    const awards: number[] = [];
    for (let i = 0; i < XP.rewardedAttemptsPerExercisePerDay + 2; i += 1) {
      awards.push((await submitAttempt(prisma, user, write(ex.id, ["好"]))).xpAwarded);
    }
    expect(awards.slice(0, XP.rewardedAttemptsPerExercisePerDay).every((a) => a > 0)).toBe(true);
    expect(awards.slice(XP.rewardedAttemptsPerExercisePerDay)).toEqual([0, 0]);
  });

  it("awards nothing for skips and a wrong character earns the minimum", async () => {
    const user = await newUser();
    const ex = await exercise(lesson1, "char:你:freehand");
    const skip = await submitAttempt(prisma, user, {
      clientEventId: randomUUID(),
      exerciseId: ex.id,
      occurredAt: new Date().toISOString(),
      kind: "skip",
    });
    expect(skip.xpAwarded).toBe(0);
    const wrong = await submitAttempt(prisma, user, write(ex.id, ["我"]));
    expect(wrong.result).toBe("TRY_AGAIN");
    expect(wrong.xpAwarded).toBe(XP.attempt.TRY_AGAIN);
  });

  it("grants the daily-goal bonus once and lesson XP only on first completion", async () => {
    const user = await newUser();
    const session = await startLessonSession(prisma, user, lesson1);
    const list = await prisma.lessonExercise.findMany({
      where: { lessonId: lesson1 },
      include: { exercise: true },
    });
    let goal = 0;
    for (const { exercise: e } of list) {
      const chars = (e.evaluationConfig as { characters: string[] }).characters;
      const out = await submitAttempt(prisma, user, {
        clientEventId: randomUUID(),
        exerciseId: e.id,
        sessionId: session.id,
        occurredAt: new Date().toISOString(),
        ...(e.type === "GUIDED_STROKE"
          ? { kind: "guided", mistakes: 0 }
          : { kind: "writing", drawings: chars.map((c, i) => ink(c, i + 9)) }),
      });
      if (out.progress?.dailyGoalReached) goal += 1;
    }
    expect(goal).toBe(1);
    const done = await completeLessonSession(prisma, user, session.id);
    expect(done.progress?.xpAwarded).toBe(XP.lessonCompleted);
    expect(done.progress?.achievements.map((a) => a.key)).toContain("first-lesson");

    // Completing the lesson again (a replay) earns no more lesson XP.
    const replay = await startLessonSession(prisma, user, lesson1);
    for (const { exercise: e } of list) {
      await submitAttempt(prisma, user, {
        clientEventId: randomUUID(),
        exerciseId: e.id,
        sessionId: replay.id,
        occurredAt: new Date().toISOString(),
        ...(e.type === "GUIDED_STROKE" ? { kind: "guided", mistakes: 0 } : { kind: "skip" }),
      });
    }
    await submitAttempt(
      prisma,
      user,
      write((await exercise(lesson1, "char:你:freehand")).id, ["你"], { sessionId: replay.id }),
    );
    await submitAttempt(
      prisma,
      user,
      write((await exercise(lesson1, "char:好:freehand")).id, ["好"], { sessionId: replay.id }),
    );
    const again = await completeLessonSession(prisma, user, replay.id);
    expect(again.progress?.xpAwarded ?? 0).toBe(0);

    const summary = await getProgressSummary(prisma, user);
    const ledger = await prisma.xPTransaction.aggregate({
      where: { userId: user },
      _sum: { amount: true },
    });
    expect(summary.xpTotal).toBe(ledger._sum.amount);
    expect(summary.today.goalMet).toBe(true);
    expect(
      await prisma.xPTransaction.count({ where: { userId: user, reason: "DAILY_GOAL_MET" } }),
    ).toBe(1);
  });
});

describe("mastery, reviews and streaks", () => {
  it("tracks guided and independent practice separately, per character in a word", async () => {
    const user = await newUser();
    const guided = await exercise(lesson1, "char:你:guided-stroke");
    await submitAttempt(prisma, user, {
      clientEventId: randomUUID(),
      exerciseId: guided.id,
      occurredAt: new Date().toISOString(),
      kind: "guided",
      mistakes: 0,
    });
    const word = await prisma.exercise.findFirstOrThrow({
      where: { lessons: { some: { lessonId: lesson1 } }, type: "PINYIN_TO_HANZI" },
    });
    await submitAttempt(prisma, user, write(word.id, ["你", "好"]));
    const rows = await prisma.characterMastery.findMany({
      where: { userId: user },
      include: { character: true },
    });
    const ni = rows.find((r) => r.character.hanzi === "你")!;
    const hao = rows.find((r) => r.character.hanzi === "好")!;
    expect(ni.guidedAttempts).toBe(1);
    expect(ni.independentAttempts).toBe(1);
    expect(hao.guidedAttempts).toBe(0);
    expect(hao.independentAttempts).toBe(1);
    expect(await prisma.reviewSchedule.count({ where: { userId: user } })).toBe(2);
  });

  it("makes characters due for review and records review XP", async () => {
    const user = await newUser();
    const ex = await exercise(lesson1, "char:你:freehand");
    const twoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString();
    await submitAttempt(prisma, user, write(ex.id, ["你"], { occurredAt: twoDaysAgo }));
    const due = await getDueReviews(prisma, user);
    expect(due.map((d) => d.hanzi)).toEqual(["你"]);
    const { session } = await startReviewSession(prisma, user);
    const out = await submitAttempt(prisma, user, write(ex.id, ["你"], { sessionId: session.id }));
    expect(out.progress?.xpAwarded).toBeGreaterThan(0);
    expect(
      await prisma.xPTransaction.count({ where: { userId: user, reason: "REVIEW_COMPLETED" } }),
    ).toBe(1);
    expect(await getDueReviews(prisma, user)).toEqual([]);
    const schedule = await prisma.reviewSchedule.findFirstOrThrow({ where: { userId: user } });
    expect(schedule.repetitions).toBe(2);
    await expect(startReviewSession(prisma, user)).rejects.toMatchObject({ code: "conflict" });
  });

  it("counts a streak across days in the learner's timezone and awards the streak achievement", async () => {
    const user = await newUser("Asia/Shanghai");
    const ex = await exercise(lesson1, "char:好:freehand");
    for (const daysAgo of [2, 1, 0]) {
      await submitAttempt(
        prisma,
        user,
        write(ex.id, ["好"], { occurredAt: new Date(Date.now() - daysAgo * DAY).toISOString() }),
      );
    }
    const summary = await getProgressSummary(prisma, user);
    expect(summary.streak.current).toBe(3);
    const earned = await prisma.userAchievement.findMany({
      where: { userId: user },
      include: { achievement: true },
    });
    expect(earned.map((e) => e.achievement.key)).toEqual(
      expect.arrayContaining(["first-character", "streak-3"]),
    );
  });

  it("serialises concurrent submissions without losing XP or double-counting", async () => {
    const user = await newUser();
    const exA = await exercise(lesson1, "char:你:freehand");
    const exB = await exercise(lesson1, "char:好:freehand");
    const results = await Promise.all([
      submitAttempt(prisma, user, write(exA.id, ["你"])),
      submitAttempt(prisma, user, write(exB.id, ["好"])),
      submitAttempt(prisma, user, write(exA.id, ["你"])),
    ]);
    const sum = results.reduce((t, r) => t + r.xpAwarded, 0);
    const activity = await prisma.dailyActivity.findMany({ where: { userId: user } });
    const goalBonus = activity.some((a) => a.goalMet) ? XP.dailyGoalBonus : 0;
    const achievements = await prisma.xPTransaction.aggregate({
      where: { userId: user, reason: "ACHIEVEMENT_EARNED" },
      _sum: { amount: true },
    });
    expect(activity.reduce((t, a) => t + a.xpEarned, 0)).toBe(
      sum + goalBonus + (achievements._sum.amount ?? 0),
    );
    expect(activity.reduce((t, a) => t + a.exercisesCompleted, 0)).toBe(3);
  });
});

describe("offline sync", () => {
  it("applies a batch in order, is idempotent and completes an offline lesson", async () => {
    const user = await newUser();
    const deviceId = randomUUID();
    const list = await prisma.lessonExercise.findMany({
      where: { lessonId: lesson1 },
      orderBy: { position: "asc" },
      include: { exercise: true },
    });
    const attemptEvents = list.map(({ exercise: e }) => {
      const id = randomUUID();
      const chars = (e.evaluationConfig as { characters: string[] }).characters;
      return {
        id,
        type: "attempt" as const,
        clientCreatedAt: new Date().toISOString(),
        payload: {
          exerciseId: e.id,
          occurredAt: new Date().toISOString(),
          ...(e.type === "GUIDED_STROKE"
            ? { kind: "guided", mistakes: 0 }
            : { kind: "writing", drawings: chars.map((c, i) => ink(c, i + 1)) }),
        },
      };
    });
    const batch = {
      deviceId,
      events: [
        ...attemptEvents,
        {
          id: randomUUID(),
          type: "lesson.complete" as const,
          clientCreatedAt: new Date().toISOString(),
          payload: {
            lessonId: lesson1,
            sessionId: null,
            attemptIds: attemptEvents.map((e) => e.id),
          },
        },
      ],
    };
    const first = await processSyncBatch(prisma, user, batch);
    expect(first.results.every((r) => r.status === "processed")).toBe(true);
    const progress = await prisma.lessonProgress.findUniqueOrThrow({
      where: { userId_lessonId: { userId: user, lessonId: lesson1 } },
    });
    expect(progress.status).toBe("COMPLETED");
    const attempts = await prisma.exerciseAttempt.findMany({ where: { userId: user } });
    expect(attempts).toHaveLength(list.length);
    expect(attempts.every((a) => a.deviceId && a.sessionId)).toBe(true);

    const second = await processSyncBatch(prisma, user, batch);
    expect(second.results.every((r) => r.status === "duplicate")).toBe(true);
    expect(await prisma.exerciseAttempt.count({ where: { userId: user } })).toBe(list.length);
    expect(await prisma.device.count({ where: { userId: user } })).toBe(1);
  });

  it("rejects invalid events without blocking the rest, and refuses another user's ids", async () => {
    const user = await newUser();
    const other = await newUser();
    const ex = await exercise(lesson1, "char:你:freehand");
    const good = {
      id: randomUUID(),
      type: "attempt" as const,
      clientCreatedAt: new Date().toISOString(),
      payload: {
        exerciseId: ex.id,
        occurredAt: new Date().toISOString(),
        kind: "writing",
        drawings: [ink("你")],
      },
    };
    const locked = {
      id: randomUUID(),
      type: "lesson.complete" as const,
      clientCreatedAt: new Date().toISOString(),
      payload: { lessonId: lesson2, attemptIds: [] },
    };
    const tooOld = {
      ...good,
      id: randomUUID(),
      payload: { ...good.payload, occurredAt: new Date(Date.now() - 60 * DAY).toISOString() },
    };
    const out = await processSyncBatch(prisma, user, {
      deviceId: randomUUID(),
      events: [locked, tooOld, good],
    });
    expect(out.results.map((r) => r.status)).toEqual(["rejected", "rejected", "processed"]);
    const stolen = await processSyncBatch(prisma, other, {
      deviceId: randomUUID(),
      events: [good],
    });
    expect(stolen.results[0]!.status).toBe("rejected");
  });

  it("resumes an interrupted sync without duplicating XP", async () => {
    const user = await newUser();
    const deviceId = randomUUID();
    const ex = await exercise(lesson1, "char:我:freehand").catch(() =>
      exercise(lesson1, "char:你:freehand"),
    );
    const events = [0, 1].map(() => ({
      id: randomUUID(),
      type: "attempt" as const,
      clientCreatedAt: new Date().toISOString(),
      payload: {
        exerciseId: ex.id,
        occurredAt: new Date().toISOString(),
        kind: "writing",
        drawings: [ink((ex.evaluationConfig as { characters: string[] }).characters[0]!)],
      },
    }));
    // A previous upload was cut off after the server stored the first event but before it
    // finished processing it.
    await prisma.syncEvent.create({
      data: {
        id: events[0]!.id,
        userId: user,
        deviceId: (await prisma.device.create({ data: { userId: user, clientId: deviceId } })).id,
        type: "attempt",
        payload: events[0]!.payload as unknown as Prisma.InputJsonValue,
        clientCreatedAt: new Date(),
      },
    });
    const first = await processSyncBatch(prisma, user, { deviceId, events });
    expect(first.results.map((r) => r.status)).toEqual(["processed", "processed"]);
    const xp = await prisma.xPTransaction.aggregate({
      where: { userId: user },
      _sum: { amount: true },
    });

    // The response was lost, so the device uploads the same batch again.
    const again = await processSyncBatch(prisma, user, { deviceId, events });
    expect(again.results.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
    const xpAfter = await prisma.xPTransaction.aggregate({
      where: { userId: user },
      _sum: { amount: true },
    });
    expect(xpAfter._sum.amount).toBe(xp._sum.amount);
    expect(await prisma.exerciseAttempt.count({ where: { userId: user } })).toBe(2);
  });
});
