import { describe, expect, it } from "vitest";
import {
  complementary,
  DEFAULT_MIN_GROUP,
  learningAnalyticsEnabled,
  publicCohort,
  publicDistribution,
  publicRate,
} from "@/features/measurement/analytics";
import {
  FUNNEL_STAGES,
  INTERVAL_BUCKETS,
  type CohortMetrics,
} from "@/features/measurement/metrics";
import { distribution, proportion, type Proportion } from "@/features/measurement/stats";
import { checkEnvironment } from "@/lib/env";

const p = (k: number, n: number, who: number, largest = 1) => proportion(k, n, who, largest);

function metrics(over: Partial<CohortMetrics> = {}, learners = 20): CohortMetrics {
  return {
    learners,
    activation: p(10, 20, 20),
    returns: { d1: p(8, 20, 20), d7: p(5, 20, 20), d30: p(2, 20, 20) },
    dueReviewCompletion: p(300, 400, 20, 40),
    recallByInterval: INTERVAL_BUCKETS.map((b) => ({
      bucket: b.key,
      label: b.label,
      recall: p(50, 60, 10, 8),
    })),
    lapseRate: p(40, 400, 20, 30),
    daysToFamiliar: distribution([1, 2, 3, 4, 5, 6], 3, 6, 1),
    daysToMastered: distribution([], 9, 9, 0),
    placementAccuracy: p(9, 12, 6, 2),
    funnel: FUNNEL_STAGES.map((s, i) => ({
      stage: s.key,
      label: s.label,
      reached: p(20 - i * 3, 20, 20),
    })),
    ...over,
  };
}
const cohort = (m: CohortMetrics) => ({ week: "2026-W40", asOf: new Date(), metrics: m });

/** Every key anywhere in a value. */
function keys(v: unknown, out = new Set<string>()): Set<string> {
  if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keys(x, out);
    }
  return out;
}

describe("primary suppression", () => {
  it("shows a value only with at least k learners", () => {
    expect(publicRate(p(3, 4, 4), 5, false)).toEqual({ shown: false, reason: "small-group" });
    expect(publicRate(p(3, 5, 5), 5, false)).toMatchObject({ shown: true, n: 5, learners: 5 });
    expect(publicRate(p(0, 0, 0), 5, false)).toEqual({ shown: false, reason: "no-data" });
  });

  it("counts learners, not events: 500 reviews from 3 learners stay hidden", () => {
    expect(publicRate(p(450, 500, 3, 200), 5, true)).toEqual({
      shown: false,
      reason: "small-group",
    });
  });

  it("refuses an event-level value dominated by one learner", () => {
    expect(publicRate(p(90, 100, 6, 51), 5, true)).toEqual({ shown: false, reason: "dominated" });
    expect(publicRate(p(90, 100, 6, 50), 5, true)).toMatchObject({ shown: true });
  });

  it("applies to distributions too", () => {
    expect(publicDistribution(distribution([1, 2, 3], 0, 3, 1), 5)).toEqual({
      shown: false,
      reason: "small-group",
    });
    expect(publicDistribution(distribution([1, 1, 1, 1, 1, 9, 9, 9, 9, 9, 9], 0, 5, 6), 5)).toEqual(
      {
        shown: false,
        reason: "dominated",
      },
    );
  });
});

describe("complementary suppression (interval buckets)", () => {
  const raw = (ns: number[]): Proportion[] => ns.map((n) => p(Math.floor(n / 2), n, 9, 1));
  const cells = (rates: ReturnType<typeof publicRate>[]) =>
    rates.map((recall, i) => ({ bucket: `${i}`, recall }));

  it("one suppressed cell forces a second: the shown cell with the fewest reviews", () => {
    const r = raw([100, 40, 3, 70]);
    const shown = r.map((x, i) =>
      i === 2 ? ({ shown: false, reason: "small-group" } as const) : publicRate(x, 5, true),
    );
    const out = complementary(cells(shown), r);
    expect(out.map((c) => (c.recall.shown ? "shown" : c.recall.reason))).toEqual([
      "shown",
      "complementary",
      "small-group",
      "shown",
    ]);
  });

  it("isn't needed with none, or with two or more suppressed; empty cells don't count", () => {
    const r = raw([100, 40, 70]);
    const all = r.map((x) => publicRate(x, 5, true));
    expect(complementary(cells(all), r)).toEqual(cells(all));
    const two = [
      all[0]!,
      { shown: false, reason: "small-group" } as const,
      { shown: false, reason: "dominated" } as const,
    ];
    expect(complementary(cells(two), r)).toEqual(cells(two));
    const empty = [all[0]!, all[1]!, { shown: false, reason: "no-data" } as const];
    expect(complementary(cells(empty), r)).toEqual(cells(empty));
  });
});

describe("public cohort", () => {
  it("a cohort with fewer than k learners shows nothing but that", () => {
    const out = publicCohort(cohort(metrics({}, 4)));
    expect(out.learners).toEqual({ shown: false, reason: "small-group" });
    // No number of any kind (labels like "1 day" are text, not counts).
    const numbers: unknown[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "number") numbers.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(out);
    expect(numbers).toEqual([]);
  });

  it("never returns internal counts, successes or identifiers", () => {
    const out = publicCohort(cohort(metrics()));
    const k = keys(out);
    for (const banned of ["largest", "successes", "contributors", "userId", "id", "email", "asOf"])
      expect(k.has(banned), banned).toBe(false);
    expect(out.activation).toMatchObject({ shown: true, rate: 0.5, n: 20, learners: 20 });
    expect(out.dueReviewCompletion).toMatchObject({ shown: true });
    expect(out.daysToMastered).toEqual({ shown: false, reason: "no-data" });
  });

  it("rounds what it shows, and refuses a minimum group below 2", () => {
    const out = publicCohort(cohort(metrics({ activation: p(1, 3, 3) }, 3)), 3);
    expect(out.activation).toMatchObject({ rate: 0.333 });
    expect(() => publicCohort(cohort(metrics()), 1)).toThrow();
    expect(DEFAULT_MIN_GROUP).toBe(5);
  });
});

describe("the learning measurement page is off by default", () => {
  it("only LEARNING_ANALYTICS=on enables it", () => {
    expect(learningAnalyticsEnabled({})).toBe(false);
    expect(learningAnalyticsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(learningAnalyticsEnabled({ LEARNING_ANALYTICS: "yes" })).toBe(false);
    expect(learningAnalyticsEnabled({ LEARNING_ANALYTICS: " ON " })).toBe(true);
  });

  it("production start-up warns when it is on", () => {
    const prod = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://x",
      AUTH_SECRET: "a".repeat(40),
      AUTH_URL: "https://app.example.com",
      AUTH_TRUST_HOST: "true",
      APP_RELEASE: "abc1234",
      SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
    };
    expect(checkEnvironment(prod).some((i) => i.name === "LEARNING_ANALYTICS")).toBe(false);
    const on = checkEnvironment({ ...prod, LEARNING_ANALYTICS: "on" });
    expect(on.find((i) => i.name === "LEARNING_ANALYTICS")).toMatchObject({ fatal: false });
  });
});
