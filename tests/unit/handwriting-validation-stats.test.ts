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
  decide,
  decisionBound,
  designEffect,
  effectiveNForPower,
  effectiveSampleSize,
  intraWriterCorrelation,
  leaveOneWriterOut,
  lookAlpha,
  passingEvents,
  powerToPass,
  requiredEffectiveN,
  writersNeeded,
  type WriterCount,
} from "@/features/handwriting/validation-stats";
import { binomialCdf, exactLowerBound, exactUpperBound } from "@/lib/statistics/binomial";

describe("exact binomial bounds", () => {
  it("binomialCdf matches direct sums", () => {
    expect(binomialCdf(0, 10, 0.1)).toBeCloseTo(0.9 ** 10, 12);
    expect(binomialCdf(1, 10, 0.1)).toBeCloseTo(0.9 ** 10 + 10 * 0.1 * 0.9 ** 9, 12);
    expect(binomialCdf(10, 10, 0.3)).toBe(1);
    expect(binomialCdf(-1, 10, 0.3)).toBe(0);
    // Large n doesn't underflow to 0 for a plausible tail.
    expect(binomialCdf(5, 5000, 0.001)).toBeGreaterThan(0.6);
  });

  it("zero events: upper bound is 1 − alpha^(1/n)", () => {
    for (const n of [10, 120, 299, 1000])
      expect(exactUpperBound(0, n)).toBeCloseTo(1 - 0.05 ** (1 / n), 9);
  });

  it("reproduces M12's pilot bounds (10 → about 26 %, 120 → about 2.5 %)", () => {
    expect(exactUpperBound(0, 10)).toBeCloseTo(0.259, 3);
    expect(exactUpperBound(0, 120)).toBeCloseTo(0.0247, 3);
  });

  it("lower and upper bounds bracket the estimate and are consistent", () => {
    for (const [x, n] of [
      [1, 50],
      [7, 300],
      [150, 300],
    ] as const) {
      const lo = exactLowerBound(x, n);
      const hi = exactUpperBound(x, n);
      expect(lo).toBeLessThan(x / n);
      expect(hi).toBeGreaterThan(x / n);
      // By definition, at the bounds the tail probability is alpha.
      expect(binomialCdf(x, n, hi)).toBeCloseTo(0.05, 6);
      expect(1 - binomialCdf(x - 1, n, lo)).toBeCloseTo(0.05, 6);
    }
    expect(exactLowerBound(0, 100)).toBe(0);
    expect(exactUpperBound(100, 100)).toBe(1);
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

  it("passingEvents agrees with requiredEffectiveN", () => {
    expect(passingEvents(298, 0.01)).toBe(-1);
    expect(passingEvents(299, 0.01)).toBe(0);
    expect(passingEvents(473, 0.01)).toBe(1);
  });

  it("power table in §8", () => {
    const pct = (n: number, rate: number, looks: number) =>
      Math.round(100 * powerToPass(n, 0.01, rate, lookAlpha(looks)));
    expect([pct(300, 0.001, 1), pct(300, 0.001, 3)]).toEqual([74, 0]);
    expect([pct(600, 0.0025, 1), pct(600, 0.0025, 3)]).toEqual([56, 22]);
    expect([pct(800, 0.005, 1), pct(800, 0.005, 3)]).toEqual([43, 24]);
    expect([pct(1000, 0.0025, 1), pct(1000, 0.0025, 3)]).toEqual([89, 76]);
  });

  it("effective n for 80 % power, and the writers it takes", () => {
    expect(effectiveNForPower(0.01, 0.0025)).toBe(775);
    expect(effectiveNForPower(0.01, 0.0025, { alpha: lookAlpha(3) })).toBe(1100);
    expect(effectiveNForPower(0.02, 0.005)).toBe(400);
    expect(effectiveNForPower(0.03, 0.0075)).toBe(275);
    expect([writersNeeded(775, 20, 0.05), writersNeeded(775, 20, 0.1)]).toEqual([76, 113]);
    expect([writersNeeded(1100, 20, 0.05), writersNeeded(1100, 20, 0.1)]).toEqual([108, 160]);
  });

  it("design effect: the withdrawn proposal is worth about 207 effective samples", () => {
    expect(designEffect(20, 0.1)).toBeCloseTo(2.9, 12);
    expect(Math.round(effectiveSampleSize(600, 20, 0.1))).toBe(207);
    expect(designEffect(1, 0.5)).toBe(1);
    expect(() => designEffect(0, 0.1)).toThrow();
    expect(() => designEffect(5, 1.5)).toThrow();
    expect(() => lookAlpha(0)).toThrow();
  });
});

describe("analysis on synthetic writers", () => {
  it("caps samples per writer and condition, keeping the earliest", () => {
    const s = [
      { w: "A", c: "correct", at: 3 },
      { w: "A", c: "correct", at: 1 },
      { w: "A", c: "correct", at: 2 },
      { w: "A", c: "missing", at: 4 },
      { w: "B", c: "correct", at: 5 },
    ];
    const { kept, excluded } = capPerWriter(s, (x) => ({ writer: x.w, condition: x.c, at: x.at }));
    expect(excluded).toBe(1);
    expect(kept.map((x) => x.at)).toEqual([1, 2, 4, 5]);
  });

  it("intra-writer correlation: near 0 for identical writers, high for split writers", () => {
    const same: WriterCount[] = Array.from({ length: 10 }, () => ({ events: 2, n: 20 }));
    expect(intraWriterCorrelation(same)).toBe(0);
    const split: WriterCount[] = [
      ...Array.from({ length: 5 }, () => ({ events: 19, n: 20 })),
      ...Array.from({ length: 5 }, () => ({ events: 1, n: 20 })),
    ];
    expect(intraWriterCorrelation(split)).toBeGreaterThan(0.7);
    expect(intraWriterCorrelation([{ events: 0, n: 20 }])).toBeNull();
    expect(intraWriterCorrelation(Array(5).fill({ events: 0, n: 20 }))).toBeNull();
  });

  it("cluster bootstrap is reproducible and wider when writers differ", () => {
    const even: WriterCount[] = Array.from({ length: 20 }, () => ({ events: 2, n: 20 }));
    const lumpy: WriterCount[] = [
      ...Array.from({ length: 2 }, () => ({ events: 20, n: 20 })),
      ...Array.from({ length: 18 }, () => ({ events: 0, n: 20 })),
    ];
    const a = clusterBootstrapInterval(lumpy, { replicates: 2000 });
    expect(a).toEqual(clusterBootstrapInterval(lumpy, { replicates: 2000 }));
    expect(clusterBootstrapInterval(even, { replicates: 2000 })).toEqual([0.1, 0.1]);
    expect(a![1] - a![0]).toBeGreaterThan(0.15);
    expect(clusterBootstrapInterval(Array(5).fill({ events: 0, n: 20 }))).toBeNull();
  });

  it("leave-one-writer-out flags a result that one writer decides", () => {
    const writers: WriterCount[] = [
      { events: 3, n: 20 },
      ...Array.from({ length: 9 }, () => ({ events: 0, n: 20 })),
    ];
    // 3 / 200 = 1.5 % fails 1 %; without the first writer, 0 % passes it.
    expect(leaveOneWriterOut(writers, 0.01).unstable).toBe(true);
    expect(leaveOneWriterOut(writers, 0.05).unstable).toBe(false);
  });

  it("decision bound: zero events from 30 writers × 20 can't show ≤ 1 % (ρ floor 0.10)", () => {
    const writers: WriterCount[] = Array.from({ length: 30 }, () => ({ events: 0, n: 20 }));
    const b = decisionBound(writers);
    expect(b.rho).toBe(0.1);
    expect(b.rhoEstimated).toBe(false);
    expect(Math.round(b.effectiveSamples)).toBe(207);
    expect(b.upper!).toBeGreaterThan(0.01);
    expect(decide(b, 0.01)).toBe("inconclusive");
    // The naive interval would have looked fine: that's why it's labelled optimistic.
    expect(b.naiveWilson![1]).toBeLessThan(0.01);
  });

  it("decision bound: enough writers pass; a clearly bad rate fails", () => {
    const many: WriterCount[] = Array.from({ length: 120 }, () => ({ events: 0, n: 20 }));
    expect(decide(decisionBound(many), 0.01)).toBe("pass");
    const bad: WriterCount[] = Array.from({ length: 40 }, (_, i) => ({
      events: i % 2 ? 2 : 1,
      n: 20,
    }));
    expect(decide(decisionBound(bad), 0.01)).toBe("fail");
    expect(decide(decisionBound([]), 0.01)).toBe("no-data");
  });

  it("the ρ floor applies even when the estimate is lower", () => {
    const writers: WriterCount[] = Array.from({ length: 40 }, () => ({ events: 1, n: 20 }));
    const b = decisionBound(writers);
    expect(b.rhoEstimated).toBe(true);
    expect(b.rho).toBe(0.1);
    expect(decisionBound(writers, { rho: 0.3 }).rho).toBe(0.3);
  });
});
