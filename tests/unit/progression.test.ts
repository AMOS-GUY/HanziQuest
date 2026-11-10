import { describe, expect, it } from "vitest";
import { deriveLessonStates } from "@/features/progression/lesson-states";
import { generateQuestions, QUESTIONS_PER_UNIT } from "@/features/assessment/placement";
import { onboardingSchema } from "@/features/onboarding/schema";
import { attemptInputSchema } from "@/features/exercises/attempt-schema";

const lessons = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("deriveLessonStates", () => {
  it("unlocks only the first lesson for a new learner", () => {
    const s = deriveLessonStates(lessons, new Map());
    expect([...s.values()]).toEqual(["AVAILABLE", "LOCKED", "LOCKED", "LOCKED"]);
  });

  it("unlocks the lesson after a completed or tested-out lesson", () => {
    const s = deriveLessonStates(
      lessons,
      new Map([
        ["a", "TESTED_OUT"],
        ["b", "COMPLETED"],
      ]),
    );
    expect([...s.values()]).toEqual(["TESTED_OUT", "COMPLETED", "AVAILABLE", "LOCKED"]);
  });

  it("keeps an in-progress lesson open but does not unlock the next one", () => {
    const s = deriveLessonStates(lessons, new Map([["a", "IN_PROGRESS"]]));
    expect(s.get("a")).toBe("IN_PROGRESS");
    expect(s.get("b")).toBe("LOCKED");
  });
});

describe("placement question generation", () => {
  const units = [
    {
      unitId: "u1",
      characters: [
        { id: "1", hanzi: "你", meaning: "you" },
        { id: "2", hanzi: "好", meaning: "good" },
        { id: "3", hanzi: "我", meaning: "I" },
      ],
    },
    {
      unitId: "u2",
      characters: [
        { id: "4", hanzi: "他", meaning: "he" },
        { id: "5", hanzi: "她", meaning: "she" },
        { id: "6", hanzi: "们", meaning: "plural marker" },
      ],
    },
  ];

  it("is deterministic per seed and differs between seeds", () => {
    expect(generateQuestions("seed-a", units)).toEqual(generateQuestions("seed-a", units));
    expect(JSON.stringify(generateQuestions("seed-a", units))).not.toEqual(
      JSON.stringify(generateQuestions("seed-b", units)),
    );
  });

  it("asks QUESTIONS_PER_UNIT (3) questions per unit with exactly one correct option", () => {
    const qs = generateQuestions("x", units);
    expect(QUESTIONS_PER_UNIT).toBe(3);
    expect(qs.filter((q) => q.unitId === "u1")).toHaveLength(3);
    expect(qs.filter((q) => q.unitId === "u2")).toHaveLength(3);
    for (const q of qs) {
      const target = units.flatMap((u) => u.characters).find((c) => c.id === q.characterId)!;
      expect(q.options[q.correctIndex]).toBe(target.meaning);
      expect(new Set(q.options).size).toBe(q.options.length);
    }
  });
});

describe("onboarding schema", () => {
  const valid = {
    experienceLevel: "BEGINNER",
    declaredHskLevel: 1,
    learningObjectives: ["write_by_hand"],
    dailyGoalXp: 20,
    timezone: "Asia/Shanghai",
    takePlacement: true,
  };
  it("accepts a valid answer set", () => {
    expect(onboardingSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects unknown time zones and goals", () => {
    expect(onboardingSchema.safeParse({ ...valid, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, dailyGoalXp: 999 }).success).toBe(false);
  });
});

describe("attempt input schema", () => {
  it("bounds stroke data size", () => {
    const point = { x: 0.5, y: 0.5, t: 0 };
    const tooManyPoints = { points: Array.from({ length: 601 }, () => point) };
    const base = {
      clientEventId: "8a6e0804-2bd0-4672-b79d-d97027f9071a",
      exerciseId: "e",
      occurredAt: new Date().toISOString(),
      kind: "writing",
    };
    expect(
      attemptInputSchema.safeParse({ ...base, drawings: [[{ points: [point] }]] }).success,
    ).toBe(true);
    expect(attemptInputSchema.safeParse({ ...base, drawings: [[tooManyPoints]] }).success).toBe(
      false,
    );
    expect(
      attemptInputSchema.safeParse({ ...base, drawings: [[{ points: [{ x: 5, y: 0, t: 0 }] }]] })
        .success,
    ).toBe(false);
  });
});
