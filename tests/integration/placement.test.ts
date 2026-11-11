import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import {
  generateQuestions,
  getPlacementLevel,
  loadLevelUnits,
  startPlacement,
  submitPlacement,
} from "@/features/assessment/placement";
import { LEARNER_VISIBLE_LESSON } from "@/features/curriculum/visibility";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { submitAttempt } from "@/features/exercises/attempts";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import {
  countPlacementChecks,
  getDueReviews,
  REVIEW_BATCH_SIZE,
  startReviewSession,
} from "@/features/learning/sessions";
import { getProgressSummary } from "@/features/progress/queries";
import { toInk } from "../support/handwriting-fixtures";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();

async function newUser() {
  const r = await registerUser(prisma, {
    displayName: "P",
    email: uniqueEmail("place"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

beforeAll(async () => {
  await ensureRoles(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("placement assessment", () => {
  it("never sends answers to the client", async () => {
    const user = await newUser();
    const { questions } = await startPlacement(prisma, user);
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) {
      expect(Object.keys(q).sort()).toEqual(["hanzi", "options"]);
      // Up to 4 options; small levels (like test fixtures) have fewer distinct meanings.
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options.length).toBeLessThanOrEqual(4);
    }
  });

  it("reuses an open assessment instead of creating many", async () => {
    const user = await newUser();
    const a = await startPlacement(prisma, user);
    const b = await startPlacement(prisma, user);
    expect(b.assessmentId).toBe(a.assessmentId);
    expect(b.questions).toEqual(a.questions);
  });

  it("tests out consecutive passed units only, records results, and cannot be resubmitted", async () => {
    const user = await newUser();
    const { assessmentId } = await startPlacement(prisma, user);
    const level = (await getPlacementLevel(prisma))!;
    const units = await loadLevelUnits(prisma, level.id);
    const questions = generateQuestions(assessmentId, units);

    // Answer the first unit correctly, everything else "I don't know".
    const firstUnit = units[0]!.unitId;
    const answers = questions.map((q) => (q.unitId === firstUnit ? q.correctIndex : null));
    const summary = await submitPlacement(prisma, user, assessmentId, answers);
    expect(summary.unitsTestedOut).toBe(1);
    expect(summary.estimatedLevel).toBe(summary.correct / summary.total >= 0.8 ? 1 : 0);

    const tested = await prisma.lessonProgress.findMany({
      where: { userId: user, status: "TESTED_OUT" },
    });
    const firstUnitLessons = await prisma.lesson.count({
      where: { unitId: firstUnit, status: "PUBLISHED" },
    });
    expect(tested).toHaveLength(firstUnitLessons);
    expect(await prisma.assessmentResult.count({ where: { assessmentId } })).toBe(questions.length);

    await expect(submitPlacement(prisma, user, assessmentId, answers)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("does not test out a later unit when an earlier one failed", async () => {
    const user = await newUser();
    const { assessmentId } = await startPlacement(prisma, user);
    const level = (await getPlacementLevel(prisma))!;
    const units = await loadLevelUnits(prisma, level.id);
    if (units.length < 2) return;
    const questions = generateQuestions(assessmentId, units);
    const answers = questions.map((q) => (q.unitId === units[0]!.unitId ? null : q.correctIndex));
    const summary = await submitPlacement(prisma, user, assessmentId, answers);
    expect(summary.unitsTestedOut).toBe(0);
    expect(await prisma.lessonProgress.count({ where: { userId: user } })).toBe(0);
  });

  it("puts tested-out characters into Review as one-time writing checks (D-044)", async () => {
    const user = await newUser();
    const { assessmentId } = await startPlacement(prisma, user);
    const level = (await getPlacementLevel(prisma))!;
    const units = await loadLevelUnits(prisma, level.id);
    const questions = generateQuestions(assessmentId, units);
    const firstUnit = units[0]!.unitId;
    // Before placement there is nothing to review.
    expect(await getDueReviews(prisma, user)).toEqual([]);
    await submitPlacement(
      prisma,
      user,
      assessmentId,
      questions.map((q) => (q.unitId === firstUnit ? q.correctIndex : null)),
    );

    // Expected: new characters of the tested-out lessons that have a free-writing exercise.
    const expected = await prisma.character.findMany({
      where: {
        lessons: {
          some: { isNew: true, lesson: { ...LEARNER_VISIBLE_LESSON, unitId: firstUnit } },
        },
        exercises: {
          some: {
            type: "FREEHAND_WRITING",
            status: "PUBLISHED",
            lessons: { some: { lesson: LEARNER_VISIBLE_LESSON } },
          },
        },
      },
      select: { id: true, hanzi: true },
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(await countPlacementChecks(prisma, user)).toBe(expected.length);
    const due = await getDueReviews(prisma, user, new Date(), 500);
    expect(due.every((d) => d.kind === "placement")).toBe(true);
    expect(due.map((d) => d.characterId).sort()).toEqual(expected.map((c) => c.id).sort());
    // Rounds stay small, Home's count includes the checks, and a review session can start.
    expect((await getDueReviews(prisma, user)).length).toBe(
      Math.min(REVIEW_BATCH_SIZE, expected.length),
    );
    expect((await getProgressSummary(prisma, user)).dueNow).toBe(expected.length);
    const { session } = await startReviewSession(prisma, user);
    // Listing checks writes nothing: mastery and schedules only come from replayed attempts.
    expect(await prisma.reviewSchedule.count({ where: { userId: user } })).toBe(0);
    expect(await prisma.characterMastery.count({ where: { userId: user } })).toBe(0);

    // Writing the first one from memory gives it a normal schedule and removes the check.
    const first = due[0]!;
    await submitAttempt(prisma, user, {
      clientEventId: randomUUID(),
      exerciseId: first.exerciseId,
      sessionId: session.id,
      occurredAt: new Date().toISOString(),
      kind: "writing" as const,
      drawings: [
        toInk(fromMakeMeAHanzi(first.hanzi, loadStrokeData(first.hanzi)!.medians).medians, {
          seed: 3,
        }),
      ],
    });
    const schedule = await prisma.reviewSchedule.findUniqueOrThrow({
      where: { userId_characterId: { userId: user, characterId: first.characterId } },
    });
    expect(schedule.dueAt.getTime()).toBeGreaterThan(Date.now());
    expect(await countPlacementChecks(prisma, user)).toBe(expected.length - 1);
    const after = await getDueReviews(prisma, user, new Date(), 500);
    expect(after.map((d) => d.characterId)).not.toContain(first.characterId);
  });

  it("rejects another user's assessment", async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const { assessmentId, questions } = await startPlacement(prisma, owner);
    await expect(
      submitPlacement(
        prisma,
        intruder,
        assessmentId,
        questions.map(() => null),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
