import { describe, expect, it } from "vitest";
import { addDays, computeStreak, liveStreak, localDay } from "@/features/progress/calendar";
import { replayCharacter, SRS, type CharacterEvent } from "@/features/progress/mastery";
import { attemptXp, XP } from "@/features/progress/xp-rules";

const T0 = new Date("2026-11-10T08:00:00Z");
const at = (days: number, minutes = 0) =>
  new Date(T0.getTime() + days * 86_400_000 + minutes * 60_000);
const ind = (d: Date, result: CharacterEvent["result"] = "EXCELLENT"): CharacterEvent => ({
  occurredAt: d,
  mode: "INDEPENDENT",
  result,
});
const guided = (d: Date, result: CharacterEvent["result"] = "EXCELLENT"): CharacterEvent => ({
  occurredAt: d,
  mode: "GUIDED",
  result,
});

describe("calendar", () => {
  it("uses the learner's timezone for the local day", () => {
    const late = new Date("2026-11-10T23:30:00Z");
    expect(localDay(late, "UTC")).toBe("2026-11-10");
    expect(localDay(late, "Asia/Shanghai")).toBe("2026-11-11");
    expect(localDay(late, "America/Los_Angeles")).toBe("2026-11-10");
    expect(localDay(late, "Not/AZone")).toBe("2026-11-10");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("computes current and longest streaks from active days, in any order", () => {
    const days = [
      "2026-11-09",
      "2026-11-01",
      "2026-11-10",
      "2026-11-02",
      "2026-11-03",
      "2026-11-08",
    ];
    expect(computeStreak(days, "2026-11-10")).toMatchObject({ current: 3, longest: 3 });
    // Yesterday still counts: the learner may practise later today.
    expect(computeStreak(days, "2026-11-11").current).toBe(3);
    expect(computeStreak(days, "2026-11-12").current).toBe(0);
    expect(computeStreak([], "2026-11-12")).toMatchObject({ current: 0, longest: 0 });
  });

  it("ignores days after today (clock skew)", () => {
    expect(computeStreak(["2026-11-10", "2026-11-11"], "2026-11-10").current).toBe(1);
  });

  it("reports a stored streak as broken after a missed day", () => {
    const stored = { currentLength: 5, lastActiveDate: new Date("2026-11-08T00:00:00Z") };
    expect(liveStreak(stored, "2026-11-09")).toBe(5);
    expect(liveStreak(stored, "2026-11-10")).toBe(0);
  });
});

describe("spaced repetition and mastery", () => {
  it("returns nothing for skipped-only history", () => {
    expect(
      replayCharacter([{ occurredAt: T0, mode: "INDEPENDENT", result: "SKIPPED" }]),
    ).toBeNull();
  });

  it("schedules 1, 3, then growing intervals for reviews done on time", () => {
    const first = replayCharacter([ind(at(0))])!;
    expect(first.review.repetitions).toBe(1);
    expect(first.review.intervalDays).toBe(1);
    expect(first.review.dueAt).toEqual(at(1));

    const third = replayCharacter([ind(at(0)), ind(at(1)), ind(at(4))])!;
    expect(third.review.repetitions).toBe(3);
    expect(third.review.intervalDays).toBeGreaterThan(3);
  });

  it("does not let early repetition (cramming) advance the schedule", () => {
    const crammed = replayCharacter([ind(at(0)), ind(at(0, 5)), ind(at(0, 10)), ind(at(0, 15))])!;
    expect(crammed.review.repetitions).toBe(1);
    expect(crammed.mastery.level).toBe("LEARNING");
    expect(crammed.mastery.independentSuccesses).toBe(4);
  });

  it("allows a review slightly before it is due", () => {
    const early = replayCharacter([ind(at(0)), ind(at(1)), ind(at(3.6))])!; // due at day 4
    expect(early.review.repetitions).toBe(3);
  });

  it("never masters a character from guided practice alone", () => {
    const events = Array.from({ length: 20 }, (_, i) => guided(at(i * 3)));
    const r = replayCharacter(events)!;
    expect(r.mastery.level).toBe("LEARNING");
    expect(r.review.repetitions).toBe(0);
    expect(r.mastery.guidedSuccesses).toBe(20);
    expect(r.mastery.strength).toBeLessThanOrEqual(0.5);
    expect(r.review.dueAt.getTime()).toBe(at(0).getTime() + SRS.guidedFirstHours * 3_600_000);
  });

  it("progresses LEARNING → FAMILIAR → MASTERED through spaced independent recall", () => {
    const events = [ind(at(0)), ind(at(1))];
    expect(replayCharacter(events)!.mastery.level).toBe("FAMILIAR");
    events.push(ind(at(4)), ind(at(12)));
    const r = replayCharacter(events)!;
    expect(r.mastery.level).toBe("MASTERED");
    expect(r.mastery.strength).toBeGreaterThan(0.7);
  });

  it("treats a failed review as a lapse and brings it back within minutes", () => {
    const events = [ind(at(0)), ind(at(1)), ind(at(4)), ind(at(12)), ind(at(31), "TRY_AGAIN")];
    const r = replayCharacter(events)!;
    expect(r.review.lapses).toBe(1);
    expect(r.review.repetitions).toBe(2);
    expect(r.review.dueAt).toEqual(at(31, SRS.relearnMinutes));
    expect(r.mastery.level).toBe("LEARNING");
    const before = replayCharacter(events.slice(0, -1))!;
    expect(r.review.easeFactor).toBeLessThan(before.review.easeFactor);
    expect(r.review.easeFactor).toBeGreaterThanOrEqual(SRS.minEase);
  });

  it("is independent of the order events arrive in (offline sync)", () => {
    const events = [
      ind(at(0)),
      guided(at(0, 1)),
      ind(at(1), "GOOD"),
      ind(at(4), "NEEDS_IMPROVEMENT"),
    ];
    const shuffled = [events[2]!, events[0]!, events[3]!, events[1]!];
    expect(replayCharacter(shuffled)).toEqual(replayCharacter(events));
  });

  it("keeps ease within bounds", () => {
    const failures = Array.from({ length: 30 }, (_, i) => ind(at(i), "TRY_AGAIN"));
    expect(replayCharacter(failures)!.review.easeFactor).toBe(SRS.minEase);
    let t = 0;
    const successes = Array.from({ length: 12 }, (_, i) => {
      t += i < 2 ? 1 : 2 ** i;
      return ind(at(t));
    });
    const r = replayCharacter(successes)!;
    expect(r.review.easeFactor).toBe(SRS.maxEase);
    expect(r.review.intervalDays).toBeLessThanOrEqual(SRS.maxIntervalDays);
  });
});

describe("XP rules", () => {
  const base = { mode: "INDEPENDENT" as const, rewardedToday: 0, attemptXpToday: 0 };

  it("awards by result, halving guided practice and nothing for skips", () => {
    expect(attemptXp({ ...base, result: "EXCELLENT" })).toBe(10);
    expect(attemptXp({ ...base, result: "GOOD" })).toBe(8);
    expect(attemptXp({ ...base, result: "TRY_AGAIN" })).toBe(1);
    expect(attemptXp({ ...base, result: "SKIPPED" })).toBe(0);
    expect(attemptXp({ ...base, result: "EXCELLENT", mode: "GUIDED" })).toBe(5);
  });

  it("stops rewarding the same exercise after the daily limit", () => {
    expect(
      attemptXp({
        ...base,
        result: "EXCELLENT",
        rewardedToday: XP.rewardedAttemptsPerExercisePerDay,
      }),
    ).toBe(0);
  });

  it("respects the daily attempt cap", () => {
    expect(
      attemptXp({ ...base, result: "EXCELLENT", attemptXpToday: XP.dailyAttemptCap - 3 }),
    ).toBe(3);
    expect(attemptXp({ ...base, result: "EXCELLENT", attemptXpToday: XP.dailyAttemptCap })).toBe(0);
  });
});
