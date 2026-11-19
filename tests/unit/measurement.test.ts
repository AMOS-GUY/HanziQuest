import { describe, expect, it } from "vitest";
import { replayCharacter, type CharacterEvent, type ReplayStep } from "@/features/progress/mastery";
import { cohortWeekOf, parseCohortWeek, recentCohortWeeks } from "@/features/measurement/cohorts";
import {
  intervalBucket,
  learnerCounts,
  MeasurementTotals,
  type LearnerHistory,
} from "@/features/measurement/metrics";
import { distribution, proportion, quantile, wilson } from "@/features/measurement/stats";
import type { AttemptResult, PracticeMode } from "@/generated/prisma/enums";

const DAY = 86_400_000;
const T0 = new Date("2026-11-02T09:00:00Z"); // a Monday
const at = (days: number) => new Date(T0.getTime() + days * DAY);

/** Deterministic PRNG (mulberry32) so the property test is reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RESULTS: AttemptResult[] = ["EXCELLENT", "GOOD", "NEEDS_IMPROVEMENT", "TRY_AGAIN", "SKIPPED"];

function randomHistory(r: () => number): CharacterEvent[] {
  const n = 1 + Math.floor(r() * 25);
  let t = T0.getTime();
  return Array.from({ length: n }, () => {
    t += Math.floor(r() * 9 * DAY);
    const mode: PracticeMode = r() < 0.25 ? "GUIDED" : "INDEPENDENT";
    const tech = r();
    return {
      occurredAt: new Date(t),
      mode,
      result: RESULTS[Math.floor(r() * RESULTS.length)]!,
      techniqueOk: tech < 0.33 ? true : tech < 0.66 ? false : null,
    };
  }).sort(() => r() - 0.5); // out of order, as offline sync delivers them
}

describe("replay observer (M15-a)", () => {
  it("never changes the replay: identical results with and without it (5,000 histories)", () => {
    const r = rng(20261119);
    for (let i = 0; i < 5000; i += 1) {
      const events = randomHistory(r);
      const plain = replayCharacter(events);
      const steps: ReplayStep[] = [];
      const observed = replayCharacter(events, (s) => {
        steps.push(s);
        // An observer that tries to tamper with what it's given changes nothing.
        s.dueAfter.setTime(0);
        if (s.dueBefore) s.dueBefore.setTime(0);
        (s as { intervalAfter: number }).intervalAfter = -1;
      });
      expect(observed, `history ${i}`).toEqual(plain);
      expect(steps.length).toBe(events.filter((e) => e.result !== "SKIPPED").length);
    }
  });

  it("classifies events as the schedule does", () => {
    const ind = (d: number, result: AttemptResult = "GOOD"): CharacterEvent => ({
      occurredAt: at(d),
      mode: "INDEPENDENT",
      result,
    });
    const steps: ReplayStep[] = [];
    replayCharacter([ind(0), ind(0.5), ind(1), ind(4), ind(4.1, "TRY_AGAIN")], (s) =>
      steps.push(structuredClone(s)),
    );
    expect(steps.map((s) => s.kind)).toEqual(["learning", "early", "due", "due", "early"]);
    // Intervals: 1 day, then 3, then 3 × ease (2.56) = 7.68 (SM-2, D-020).
    expect(steps.slice(0, 4).map((s) => s.intervalBefore)).toEqual([0, 1, 1, 3]);
    expect(steps[4]!.intervalBefore).toBeCloseTo(7.68, 2);
    expect(steps[4]).toMatchObject({ lapse: true, success: false, intervalAfter: 0 });
    expect(steps[3]!.levelAfter).toBe("FAMILIAR");
  });
});

describe("statistics", () => {
  it("Wilson intervals match published values", () => {
    const [lo, hi] = wilson(5, 10);
    expect(lo).toBeCloseTo(0.2366, 4);
    expect(hi).toBeCloseTo(0.7634, 4);
    const [lo0, hi0] = wilson(0, 10);
    expect(lo0).toBe(0);
    expect(hi0).toBeCloseTo(0.2775, 4);
    expect(wilson(10, 10)[1]).toBeCloseTo(1, 12);
    expect(() => wilson(1, 0)).toThrow();
    expect(proportion(0, 0, 0)).toEqual({
      successes: 0,
      n: 0,
      contributors: 0,
      largest: 0,
      rate: null,
      interval: null,
    });
  });

  it("quantiles interpolate like R type 7", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([], 0.5)).toBeNull();
    expect(distribution([3, 1, 2], 4, 2)).toMatchObject({ n: 3, notYet: 4, median: 2 });
  });
});

describe("signup-week cohorts", () => {
  it("are ISO weeks, Monday 00:00 UTC", () => {
    expect(cohortWeekOf(new Date("2026-11-19T12:00:00Z"))).toBe("2026-W47");
    expect(cohortWeekOf(new Date("2026-11-16T00:00:00Z"))).toBe("2026-W47");
    expect(cohortWeekOf(new Date("2026-11-15T23:59:59Z"))).toBe("2026-W46");
    expect(cohortWeekOf(new Date("2024-12-30T10:00:00Z"))).toBe("2025-W01");
    expect(parseCohortWeek("2026-W47")).toEqual({
      start: new Date("2026-11-16T00:00:00Z"),
      end: new Date("2026-11-23T00:00:00Z"),
    });
  });

  it("refuses anything but a real week (no arbitrary ranges)", () => {
    for (const bad of ["2021-W53", "2026-W00", "2026-W54", "2026-11-16", "2026-W7", "x"])
      expect(parseCohortWeek(bad), bad).toBeNull();
    expect(parseCohortWeek("2020-W53")).not.toBeNull();
  });

  it("lists whole past weeks only", () => {
    expect(recentCohortWeeks(new Date("2026-11-19T12:00:00Z"), 3)).toEqual([
      "2026-W46",
      "2026-W45",
      "2026-W44",
    ]);
  });
});

const base = (over: Partial<LearnerHistory> = {}): LearnerHistory => ({
  createdAt: T0,
  timezone: "UTC",
  activeDays: new Set(),
  firstLessonCompletedAt: null,
  characters: new Map(),
  placement: null,
  ...over,
});

describe("learner counts (definitions)", () => {
  it("activation: a lesson within 24 h; not eligible before 24 h have passed", () => {
    expect(learnerCounts(base(), at(0.5)).activation).toEqual({ k: 0, n: 0 });
    expect(learnerCounts(base({ firstLessonCompletedAt: at(0.9) }), at(2)).activation).toEqual({
      k: 1,
      n: 1,
    });
    expect(learnerCounts(base({ firstLessonCompletedAt: at(1.1) }), at(2)).activation).toEqual({
      k: 0,
      n: 1,
    });
  });

  it("return Dn: practised on local day signup + n, eligible once that day is over", () => {
    // Signed up 23:30 UTC on Nov 2, which is already Nov 3 in Tokyo.
    const created = new Date("2026-11-02T23:30:00Z");
    const h = base({
      createdAt: created,
      timezone: "Asia/Tokyo",
      activeDays: new Set(["2026-11-04"]),
    });
    const c = learnerCounts(h, new Date("2026-11-05T12:00:00Z"));
    expect(c.returns[1]).toEqual({ k: 1, n: 1 }); // Nov 4 Tokyo = signup day + 1
    expect(c.returns[7]).toEqual({ k: 0, n: 0 }); // not over yet
    const utc = learnerCounts({ ...h, timezone: "UTC" }, new Date("2026-11-05T12:00:00Z"));
    expect(utc.returns[1]).toEqual({ k: 0, n: 1 }); // in UTC, day + 1 is Nov 3
  });

  it("recall by interval bucket, lapses, due completion, time to FAMILIAR", () => {
    const ind = (d: number, result: AttemptResult = "GOOD"): CharacterEvent => ({
      occurredAt: at(d),
      mode: "INDEPENDENT",
      result,
    });
    const h = base({
      characters: new Map([
        // Learn (day 0), due at 1 (1-day interval), due at 4 (3-day interval, next 7.68 days,
        // due 11.68), then a failure on day 13 under the 7.68-day interval.
        ["c1", [ind(0), ind(1), ind(4), ind(13, "TRY_AGAIN")]],
      ]),
    });
    const c = learnerCounts(h, at(60));
    expect(c.recall["1"]).toEqual({ k: 1, n: 1 });
    expect(c.recall["2-3"]).toEqual({ k: 1, n: 1 });
    expect(c.recall["4-7"]).toEqual({ k: 0, n: 1 });
    expect(c.lapses).toEqual({ k: 1, n: 3 });
    // Scheduled ≥ 1 day ahead: due at 1, 4 and 11.68. Day 13 is past 11.68 + 1 day, so that one
    // wasn't completed in time.
    expect(c.dueCompletion).toEqual({ k: 2, n: 3 });
    // FAMILIAR needs 2 repetitions: reached at the recall on day 1.
    expect(c.toFamiliar.days).toEqual([1]);
    expect(c.toMastered.notYet).toBe(1);
    expect(intervalBucket(0)).toBe("relearn");
    expect(intervalBucket(31)).toBe("31+");
  });

  it("a missed review counts as not completed; one not yet over isn't counted", () => {
    const ind = (d: number): CharacterEvent => ({
      occurredAt: at(d),
      mode: "INDEPENDENT",
      result: "GOOD",
    });
    // Due at 1 but written at 5 (missed); day 5 then schedules a review due at 8, never written.
    const h = base({ characters: new Map([["c", [ind(0), ind(5)]]]) });
    expect(learnerCounts(h, at(30)).dueCompletion).toEqual({ k: 0, n: 2 });
    // At day 4, only the first is over: the second isn't due yet.
    expect(learnerCounts(h, at(4)).dueCompletion).toEqual({ k: 0, n: 1 });
    expect(learnerCounts(h, at(1.5)).dueCompletion.n).toBe(0);
  });

  it("placement accuracy: the first recall after placement of a tested-out character", () => {
    const ind = (d: number, result: AttemptResult): CharacterEvent => ({
      occurredAt: at(d),
      mode: "INDEPENDENT",
      result,
    });
    const h = base({
      placement: { completedAt: at(0.1), testedOut: new Set(["a", "b", "c"]) },
      characters: new Map([
        ["a", [ind(1, "GOOD"), ind(2, "TRY_AGAIN")]],
        ["b", [ind(1, "TRY_AGAIN")]],
        ["z", [ind(1, "GOOD")]], // not tested out
      ]),
    });
    expect(learnerCounts(h, at(10)).placement).toEqual({ k: 1, n: 2 }); // "c" never written
  });
});

describe("totals", () => {
  it("count contributors (distinct learners), not events", () => {
    const ind = (d: number): CharacterEvent => ({
      occurredAt: at(d),
      mode: "INDEPENDENT",
      result: "GOOD",
    });
    const busy = base({
      characters: new Map(
        Array.from({ length: 20 }, (_, i) => [`c${i}`, [ind(0), ind(1)]] as const),
      ),
    });
    const t = new MeasurementTotals();
    t.add(learnerCounts(busy, at(40)));
    t.add(learnerCounts(base(), at(40)));
    const r = t.result();
    expect(r.learners).toBe(2);
    const oneDay = r.recallByInterval.find((b) => b.bucket === "1")!.recall;
    expect(oneDay).toMatchObject({ n: 20, successes: 20, contributors: 1 });
    expect(r.activation).toMatchObject({ n: 2, contributors: 2 });
  });
});
