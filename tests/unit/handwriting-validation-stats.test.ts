/**
 * M13 validation statistics. Every input here is SYNTHETIC: these tests check arithmetic, and
 * none of their numbers is evidence about the engine or about real learners.
 *
 * The planning tests pin the tables in M13_VALIDATION_PROTOCOL.md §8 (D-083): if one of them
 * changes, the protocol is wrong or the code is, and the protocol must be updated with a
 * decision entry.
 */
import { describe, expect, it } from "vitest";

import {
  capPerWriter,
  clusterBootstrapInterval,
  countByWriter,
  decide,
  decisionBound,
  designEffect,
  EVIDENCE_STATUS,
  effectiveNForPower,
  effectiveSampleSize,
  intraWriterCorrelation,
  leaveOneWriterOut,
  lookAlpha,
  lookSchedule,
  MIN_BOOTSTRAP_WRITERS,
  pairSummaries,
  passingEvents,
  powerToPass,
  requiredEffectiveN,
  writersNeeded,
  type WriterCount,
} from "@/features/handwriting/validation-stats";
import { binomialCdf, exactLowerBound, exactUpperBound } from "@/lib/statistics/binomial";

const repeat = (count: number, c: WriterCount): WriterCount[] =>
  Array.from({ length: count }, () => ({ ...c }));

/** Exact binomial pmf by direct product, for checking the recurrence. */
function pmf(k: number, n: number, p: number) {
  let c = 1;
  for (let i = 1; i <= k; i += 1) c = (c * (n - k + i)) / i;
  return c * p ** k * (1 - p) ** (n - k);
}

describe("exact binomial bounds", () => {
  it("binomialCdf matches direct sums", () => {
    for (const [x, n, p] of [
      [0, 10, 0.1],
      [3, 10, 0.1],
      [7, 30, 0.25],
      [12, 40, 0.5],
    ] as const) {
      let direct = 0;
      for (let k = 0; k <= x; k += 1) direct += pmf(k, n, p);
      expect(binomialCdf(x, n, p)).toBeCloseTo(direct, 12);
    }
    expect(binomialCdf(10, 10, 0.3)).toBe(1);
    expect(binomialCdf(-1, 10, 0.3)).toBe(0);
    expect(binomialCdf(0, 10, 0)).toBe(1);
    expect(binomialCdf(3, 10, 1)).toBe(0);
  });

  it("stays accurate for large n, tiny p, and p near 1", () => {
    // Poisson limit: n = 100,000, p = 2e-5 → λ = 2; P(X ≤ 2) ≈ 5e^-2.
    expect(binomialCdf(2, 100_000, 2e-5)).toBeCloseTo(5 * Math.exp(-2), 4);
    // The first term (1 − p)^n underflows a naive product, not the log recurrence.
    expect(binomialCdf(700, 1000, 0.7)).toBeGreaterThan(0.5);
    expect(binomialCdf(700, 1000, 0.7)).toBeLessThan(0.53);
  });

  it("zero events: upper bound is 1 − alpha^(1/n)", () => {
    for (const n of [10, 120, 299, 1000])
      expect(exactUpperBound(0, n)).toBeCloseTo(1 - 0.05 ** (1 / n), 9);
  });

  it("all events: lower bound is alpha^(1/n)", () => {
    for (const n of [5, 50]) expect(exactLowerBound(n, n)).toBeCloseTo(0.05 ** (1 / n), 9);
  });

  it("reproduces M12's pilot bounds (10 → about 26 %, 120 → about 2.5 %)", () => {
    expect(exactUpperBound(0, 10)).toBeCloseTo(0.259, 3);
    expect(exactUpperBound(0, 120)).toBeCloseTo(0.0247, 3);
  });

  it("bounds bracket the estimate and hit alpha exactly at the bound", () => {
    for (const [x, n] of [
      [1, 50],
      [7, 300],
      [150, 300],
    ] as const) {
      const lo = exactLowerBound(x, n);
      const hi = exactUpperBound(x, n);
      expect(lo).toBeLessThan(x / n);
      expect(hi).toBeGreaterThan(x / n);
      expect(binomialCdf(x, n, hi)).toBeCloseTo(0.05, 9);
      expect(1 - binomialCdf(x - 1, n, lo)).toBeCloseTo(0.05, 9);
    }
    expect(exactLowerBound(0, 100)).toBe(0);
    expect(exactUpperBound(100, 100)).toBe(1);
  });

  it("a smaller alpha widens both bounds", () => {
    expect(exactUpperBound(3, 300, lookAlpha(3))).toBeGreaterThan(exactUpperBound(3, 300));
    expect(exactLowerBound(3, 300, lookAlpha(3))).toBeLessThan(exactLowerBound(3, 300));
  });

  it("rejects invalid input instead of returning a silent wrong answer", () => {
    expect(() => exactUpperBound(1.5, 10)).toThrow();
    expect(() => exactUpperBound(11, 10)).toThrow();
    expect(() => exactUpperBound(-1, 10)).toThrow();
    expect(() => exactUpperBound(0, 0)).toThrow();
    expect(() => exactLowerBound(0, 10, 0)).toThrow();
    expect(() => binomialCdf(1, 10, 1.2)).toThrow();
    expect(() => binomialCdf(1, 10.5, 0.2)).toThrow();
  });
});

describe("planning (pins M13_VALIDATION_PROTOCOL.md §8)", () => {
  it("required effective n for the table in §8", () => {
    const a3 = lookAlpha(3);
    expect(requiredEffectiveN(0.01, 0)).toBe(299);
    expect(requiredEffectiveN(0.01, 1)).toBe(473);
    expect(requiredEffectiveN(0.01, 0, a3)).toBe(408);
    expect(requiredEffectiveN(0.01, 1, a3)).toBe(603);
    expect(requiredEffectiveN(0.02, 0)).toBe(149);
    expect(requiredEffectiveN(0.02, 1)).toBe(236);
    expect(requiredEffectiveN(0.02, 0, a3)).toBe(203);
    expect(requiredEffectiveN(0.02, 1, a3)).toBe(300);
  });

  it("passingEvents agrees with requiredEffectiveN and the exact bound", () => {
    expect(passingEvents(298, 0.01)).toBe(-1);
    expect(passingEvents(299, 0.01)).toBe(0);
    expect(passingEvents(473, 0.01)).toBe(1);
    for (const n of [299, 600, 1000]) {
      const c = passingEvents(n, 0.01);
      expect(exactUpperBound(c, n)).toBeLessThanOrEqual(0.01 + 1e-12);
      expect(exactUpperBound(c + 1, n)).toBeGreaterThan(0.01);
    }
  });

  it("power table in §8", () => {
    const pct = (n: number, rate: number, looks: number) =>
      Math.round(100 * powerToPass(n, 0.01, rate, lookAlpha(looks)));
    expect([pct(300, 0.001, 1), pct(300, 0.001, 3)]).toEqual([74, 0]);
    expect([pct(300, 0.0025, 1), pct(300, 0.005, 1)]).toEqual([47, 22]);
    expect([pct(600, 0.001, 1), pct(600, 0.001, 3)]).toEqual([88, 55]);
    expect([pct(600, 0.0025, 1), pct(600, 0.0025, 3)]).toEqual([56, 22]);
    expect([pct(800, 0.001, 1), pct(800, 0.0025, 1)]).toEqual([99, 86]);
    expect([pct(800, 0.005, 1), pct(800, 0.005, 3)]).toEqual([43, 24]);
    expect([pct(1000, 0.0025, 1), pct(1000, 0.0025, 3)]).toEqual([89, 76]);
    expect([pct(1000, 0.005, 1), pct(1000, 0.005, 3)]).toEqual([44, 26]);
  });

  it("power saw-tooths in n: it falls while the passing count stays the same", () => {
    // 473 and 600 both allow 1 event; more samples at the same allowance means lower power.
    expect(passingEvents(473, 0.01)).toBe(passingEvents(600, 0.01));
    expect(powerToPass(473, 0.01, 0.0025)).toBeCloseTo(0.669, 3);
    expect(powerToPass(600, 0.01, 0.0025)).toBeCloseTo(0.558, 3);
    // The exact first n with 80 % power is 773; the §8 table's 775 is the planner's 25-step grid.
    expect(effectiveNForPower(0.01, 0.0025, { step: 1 })).toBe(773);
    expect(powerToPass(772, 0.01, 0.0025)).toBeLessThan(0.8);
  });

  it("effective n for 80 % power, and the writers it takes", () => {
    expect(effectiveNForPower(0.01, 0.0025)).toBe(775);
    expect(effectiveNForPower(0.01, 0.0025, { alpha: lookAlpha(3) })).toBe(1100);
    expect(effectiveNForPower(0.02, 0.005)).toBe(400);
    expect(effectiveNForPower(0.02, 0.005, { alpha: lookAlpha(3) })).toBe(550);
    expect(effectiveNForPower(0.03, 0.0075)).toBe(275);
    expect(effectiveNForPower(0.03, 0.0075, { alpha: lookAlpha(3) })).toBe(375);
    expect([writersNeeded(775, 20, 0.05), writersNeeded(775, 20, 0.1)]).toEqual([76, 113]);
    expect([writersNeeded(1100, 20, 0.05), writersNeeded(1100, 20, 0.1)]).toEqual([108, 160]);
    expect([writersNeeded(400, 20, 0.05), writersNeeded(550, 20, 0.1)]).toEqual([40, 80]);
    expect([writersNeeded(275, 20, 0.05), writersNeeded(375, 20, 0.1)]).toEqual([27, 55]);
    // A true rate at or above the target can never reach 80 % power.
    expect(effectiveNForPower(0.01, 0.01, { max: 5000 })).toBeNull();
  });

  it("design effect: the withdrawn proposal is worth about 207 effective samples", () => {
    expect(designEffect(20, 0.1)).toBeCloseTo(2.9, 12);
    expect(Math.round(effectiveSampleSize(600, 20, 0.1))).toBe(207);
    expect(Math.round(effectiveSampleSize(300, 10, 0.1))).toBe(158);
    expect(designEffect(1, 0.5)).toBe(1);
    expect(() => designEffect(0, 0.1)).toThrow();
    expect(() => designEffect(5, 1.5)).toThrow();
    expect(() => designEffect(5, Number.NaN)).toThrow();
    expect(() => lookAlpha(0)).toThrow();
    expect(() => requiredEffectiveN(0, 0)).toThrow();
    expect(() => requiredEffectiveN(0.01, -1)).toThrow();
  });

  it("look schedule at about 50 %, 75 % and 100 % of the planned writers (§9)", () => {
    expect(lookSchedule(40)).toEqual([20, 30, 40]);
    expect(lookSchedule(113)).toEqual([57, 85, 113]);
    expect(lookSchedule(2)).toEqual([1, 2]);
    expect(() => lookSchedule(1)).toThrow();
  });
});

describe("analysis on synthetic writers", () => {
  it("caps per (writer, character, condition), keeping the earliest", () => {
    const s = [
      { w: "A", ch: "人", c: "correct", at: 3 },
      { w: "A", ch: "人", c: "correct", at: 1 },
      { w: "A", ch: "人", c: "correct", at: 2 },
      // Same writer and condition, different character: its own cell (§4).
      { w: "A", ch: "大", c: "correct", at: 6 },
      { w: "A", ch: "人", c: "missing", at: 4 },
      { w: "B", ch: "人", c: "correct", at: 5 },
    ];
    const { kept, excluded } = capPerWriter(s, (x) => ({
      writer: x.w,
      character: x.ch,
      condition: x.c,
      at: x.at,
    }));
    expect(excluded).toBe(1);
    expect(kept.map((x) => x.at)).toEqual([1, 2, 6, 4, 5]);
    expect(() =>
      capPerWriter(s, () => ({ writer: "", character: "", condition: "", at: 0 }), 0),
    ).toThrow();
  });

  it("cap keys can't collide through separators in the names", () => {
    const s = [
      { writer: "A", character: "x", condition: "y|z", at: 1 },
      { writer: "A", character: "x|y", condition: "z", at: 2 },
      { writer: "A", character: "x|y", condition: "z", at: 3 },
    ];
    expect(capPerWriter(s, (x) => x, 1).excluded).toBe(1);
  });

  it("intra-writer correlation: 0 for identical writers, high for split writers", () => {
    expect(intraWriterCorrelation(repeat(10, { events: 2, n: 20 }))).toBe(0);
    const split = [...repeat(5, { events: 19, n: 20 }), ...repeat(5, { events: 1, n: 20 })];
    expect(intraWriterCorrelation(split)).toBeGreaterThan(0.7);
    expect(intraWriterCorrelation([{ events: 0, n: 20 }])).toBeNull();
    expect(intraWriterCorrelation(repeat(5, { events: 0, n: 20 }))).toBeNull();
    // One sample per writer: no within-writer replication.
    expect(intraWriterCorrelation(repeat(5, { events: 1, n: 1 }))).toBeNull();
  });

  it("intra-writer correlation recovers a known ρ on simulated clusters", () => {
    // Beta-binomial clusters: writer rate ~ Beta(a, b) with a + b = 9 → ρ = 1 / (a + b + 1) = 0.1.
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const gamma = (shape: number): number => {
      // Marsaglia–Tsang for shape ≥ 1; boost for shape < 1.
      if (shape < 1) return gamma(shape + 1) * rand() ** (1 / shape);
      const d = shape - 1 / 3;
      const c = 1 / Math.sqrt(9 * d);
      for (;;) {
        let x: number;
        let v: number;
        do {
          const u1 = rand();
          const u2 = rand();
          x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
          v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        if (Math.log(rand() || 1e-12) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
      }
    };
    const writers: WriterCount[] = Array.from({ length: 400 }, () => {
      const g1 = gamma(2.7);
      const p = g1 / (g1 + gamma(6.3)); // mean 0.3
      let events = 0;
      for (let i = 0; i < 20; i += 1) if (rand() < p) events += 1;
      return { events, n: 20 };
    });
    const rho = intraWriterCorrelation(writers)!;
    expect(rho).toBeGreaterThan(0.06);
    expect(rho).toBeLessThan(0.14);
  });

  it("rejects impossible writer counts", () => {
    expect(() => intraWriterCorrelation([{ events: 3, n: 2 }])).toThrow();
    expect(() => decisionBound([{ events: -1, n: 2 }])).toThrow();
    expect(() => decisionBound([{ events: 0.5, n: 2 }])).toThrow();
  });

  it("cluster bootstrap is reproducible, seed-dependent and wider when writers differ", () => {
    const even = repeat(20, { events: 2, n: 20 });
    const lumpy = [...repeat(2, { events: 20, n: 20 }), ...repeat(18, { events: 0, n: 20 })];
    const a = clusterBootstrapInterval(lumpy, { replicates: 2000 });
    expect(a).toEqual(clusterBootstrapInterval(lumpy, { replicates: 2000 }));
    const varied = Array.from({ length: 30 }, (_, i) => ({
      events: i % 3 === 0 ? (i % 4) + 1 : 0,
      n: 20,
    }));
    expect(clusterBootstrapInterval(varied, { replicates: 2000 })).not.toEqual(
      clusterBootstrapInterval(varied, { replicates: 2000, seed: 1 }),
    );
    expect(clusterBootstrapInterval(even, { replicates: 2000 })).toEqual([0.1, 0.1]);
    expect(a![1] - a![0]).toBeGreaterThan(0.15);
    expect(a![0]).toBeLessThan(0.1);
    expect(a![1]).toBeGreaterThan(0.1);
  });

  it("no bootstrap for zero or all events, or too few writers", () => {
    expect(clusterBootstrapInterval(repeat(20, { events: 0, n: 20 }))).toBeNull();
    expect(clusterBootstrapInterval(repeat(20, { events: 20, n: 20 }))).toBeNull();
    const few = [...repeat(MIN_BOOTSTRAP_WRITERS - 2, { events: 1, n: 20 }), { events: 5, n: 20 }];
    expect(clusterBootstrapInterval(few)).toBeNull();
    expect(() => clusterBootstrapInterval(few, { replicates: 10 })).toThrow();
  });

  it("leave-one-writer-out flags a result that one writer decides", () => {
    const writers = [{ events: 3, n: 20 }, ...repeat(9, { events: 0, n: 20 })];
    // 3 / 200 = 1.5 % misses 1 %; without the first writer, 0 % meets it.
    expect(leaveOneWriterOut(writers, 0.01).unstable).toBe(true);
    expect(leaveOneWriterOut(writers, 0.05).unstable).toBe(false);
    expect(leaveOneWriterOut([{ events: 0, n: 5 }], 0.01)).toEqual({
      rates: [null],
      unstable: false,
    });
    // Writers with no samples carry no information and don't appear.
    expect(leaveOneWriterOut([{ events: 0, n: 0 }, ...writers], 0.01).rates).toHaveLength(10);
  });
});

describe("decision bound and rule (§3, §9)", () => {
  it("zero events from 30 writers × 20 can't show ≤ 1 % (ρ floor 0.10)", () => {
    const b = decisionBound(repeat(30, { events: 0, n: 20 }));
    expect(b.method).toBe("exact-effective-n");
    expect(b.rho).toBe(0.1);
    expect(b.rhoEstimated).toBe(false);
    expect(Math.round(b.effectiveSamples)).toBe(207);
    expect(b.upper!).toBeGreaterThan(0.01);
    expect(decide(b, 0.01)).toBe("inconclusive");
    expect(decide(b, 0.01, { finalLook: false })).toBe("expand");
    // The naive interval would have looked fine: that's why it's labelled optimistic.
    expect(b.naiveWilson![1]).toBeLessThan(0.02);
  });

  it("enough writers with zero events pass; a clearly bad rate fails", () => {
    expect(decide(decisionBound(repeat(120, { events: 0, n: 20 })), 0.01)).toBe("pass");
    const bad = Array.from({ length: 40 }, (_, i) => ({ events: i % 2 ? 2 : 1, n: 20 }));
    const b = decisionBound(bad);
    expect(b.method).toBe("conservative");
    expect(decide(b, 0.01)).toBe("fail");
    expect(decide(decisionBound([]), 0.01)).toBe("no-data");
  });

  it("sparse events: the default takes the worse bound, so 40 writers can't show ≤ 1 % (D-083)", () => {
    // 3 accepted wrong characters among 40 writers × 20 samples (0.375 %).
    const writers = [...repeat(3, { events: 1, n: 20 }), ...repeat(37, { events: 0, n: 20 })];
    const b = decisionBound(writers);
    expect(b.rule).toBe("conservative");
    expect(b.method).toBe("conservative");
    // The percentile bootstrap is optimistic here: tighter even than the naive Wilson bound.
    expect(b.bootstrap![1]).toBeLessThan(0.01);
    expect(b.bootstrap![1]).toBeLessThan(b.naiveWilson![1]);
    expect(b.exactUpper!).toBeGreaterThan(0.02);
    expect(b.upper).toBe(Math.max(b.bootstrap![1], b.exactUpper!));
    expect(b.lower).toBe(Math.min(b.bootstrap![0], b.exactLower!));
    expect(decide(b, 0.01)).toBe("inconclusive");
    // §3 as written would pass it: the contradiction with D-083 the owner must resolve.
    const literal = decisionBound(writers, { rule: "bootstrap-first" });
    expect(literal.method).toBe("bootstrap");
    expect(literal.upper).toBe(literal.bootstrap![1]);
    expect(decide(literal, 0.01)).toBe("pass");
  });

  it("where the bootstrap can't be used, both rules use the exact bound", () => {
    const zero = repeat(120, { events: 0, n: 20 });
    for (const rule of ["conservative", "bootstrap-first"] as const) {
      const b = decisionBound(zero, { rule });
      expect(b.method).toBe("exact-effective-n");
      expect(b.upper).toBe(b.exactUpper);
    }
  });

  it("the ρ floor applies even when the estimate is lower; a given ρ is used", () => {
    const writers = repeat(40, { events: 1, n: 20 });
    const b = decisionBound(writers);
    expect(b.rhoEstimated).toBe(true);
    expect(b.rho).toBe(0.1);
    expect(decisionBound(writers, { rho: 0.3 }).rho).toBe(0.3);
    expect(decisionBound(writers, { rho: 0.3 }).rhoEstimated).toBe(false);
    expect(decisionBound(writers, { rho: 0.01 }).rho).toBe(0.1);
  });

  it("unequal writers: the design effect uses Σnᵢ²/N, so it's more conservative", () => {
    // Same total (600) as 30 × 20, but one writer contributes half the samples.
    const lopsided = [
      { events: 0, n: 300 },
      ...repeat(29, { events: 0, n: 10 }),
      { events: 0, n: 10 },
    ];
    const b = decisionBound(lopsided);
    expect(b.samples).toBe(600);
    expect(b.clusterSize).toBeCloseTo((300 ** 2 + 30 * 10 ** 2) / 600, 9);
    expect(b.effectiveSamples).toBeLessThan(effectiveSampleSize(600, 20, 0.1));
    expect(decisionBound(repeat(30, { events: 0, n: 20 })).clusterSize).toBe(20);
  });

  it("scaled events round up for the upper bound and down for the lower bound", () => {
    // 3 / 600 scaled to 206 effective samples = 1.03 events: 2 for the upper, 1 for the lower.
    const writers = [...repeat(3, { events: 1, n: 20 }), ...repeat(27, { events: 0, n: 20 })];
    const b = decisionBound(writers, { rho: 0.1 });
    expect(Math.floor(b.effectiveSamples)).toBe(206);
    expect(b.exactUpper).toBeCloseTo(exactUpperBound(2, 206), 12);
    expect(b.exactLower).toBeCloseTo(exactLowerBound(1, 206), 12);
  });

  it("Bonferroni looks widen the decision bound", () => {
    const writers = repeat(120, { events: 0, n: 20 });
    const one = decisionBound(writers);
    const three = decisionBound(writers, { alpha: lookAlpha(3) });
    expect(three.upper!).toBeGreaterThan(one.upper!);
    expect(() => decisionBound(writers, { alpha: 0.6 })).toThrow();
  });

  it("at-least targets (specific error named ≥ 80 %)", () => {
    const good = repeat(40, { events: 19, n: 20 });
    const poor = repeat(40, { events: 12, n: 20 });
    expect(decide(decisionBound(good), 0.8, { direction: "at-least" })).toBe("pass");
    expect(decide(decisionBound(poor), 0.8, { direction: "at-least" })).toBe("fail");
    expect(() => decide(decisionBound(good), 1)).toThrow();
  });

  it("labels every result exploratory, so a pass is never read as validated", () => {
    expect(EVIDENCE_STATUS).toBe("exploratory");
    for (const w of [[], repeat(120, { events: 0, n: 20 }), repeat(40, { events: 1, n: 20 })])
      for (const rule of ["conservative", "bootstrap-first"] as const)
        expect(decisionBound(w, { rule }).evidence).toBe("exploratory");
  });

  it("is deterministic for a given seed", () => {
    const writers = [...repeat(5, { events: 2, n: 20 }), ...repeat(25, { events: 0, n: 20 })];
    expect(decisionBound(writers)).toEqual(decisionBound(writers));
  });
});

describe("look-alike pairs (§6) and counting", () => {
  it("a finding needs ≥ 2 accepted samples from ≥ 2 writers", () => {
    const s = [
      { pair: "他/她", writer: "A", accepted: true },
      { pair: "他/她", writer: "A", accepted: true },
      { pair: "他/她", writer: "B", accepted: false },
      { pair: "人/八", writer: "A", accepted: true },
      { pair: "人/八", writer: "B", accepted: true },
      { pair: "日/目", writer: "C", accepted: false },
    ];
    expect(pairSummaries(s)).toEqual([
      { pair: "人/八", accepted: 2, written: 2, writers: 2, acceptingWriters: 2, finding: true },
      { pair: "他/她", accepted: 2, written: 3, writers: 2, acceptingWriters: 1, finding: false },
      { pair: "日/目", accepted: 0, written: 1, writers: 1, acceptingWriters: 0, finding: false },
    ]);
    expect(pairSummaries([])).toEqual([]);
  });

  it("counts per writer in a stable order", () => {
    const s = [
      { w: "B", ok: true },
      { w: "A", ok: false },
      { w: "B", ok: false },
    ];
    expect(
      countByWriter(
        s,
        (x) => x.w,
        (x) => x.ok,
      ),
    ).toEqual([
      { events: 0, n: 1 },
      { events: 1, n: 2 },
    ]);
  });
});
