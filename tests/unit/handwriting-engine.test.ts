import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateCharacter, evaluateWord } from "@/features/handwriting/evaluate";
import { assign, longestIncreasingSubsequence, resample } from "@/features/handwriting/geometry";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import { isRecall, techniqueNote, techniqueVerdict } from "@/features/handwriting/technique";
import type { ReferenceCharacter } from "@/features/handwriting/types";
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { longestStroke, toInk, variants } from "../support/handwriting-fixtures";

const content = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../../content/hsk1-starter.json"), "utf8"),
) as { characters: Record<string, unknown> };
const REFERENCES: ReferenceCharacter[] = Object.keys(content.characters).map((hanzi) =>
  fromMakeMeAHanzi(hanzi, loadStrokeData(hanzi)!.medians),
);
const ref = (hanzi: string) => REFERENCES.find((r) => r.hanzi === hanzi)!;
const evaluate = (ink: ReturnType<typeof toInk>, expected: ReferenceCharacter) =>
  evaluateCharacter(ink, expected, { candidates: REFERENCES });

describe("geometry", () => {
  it("resamples to evenly spaced points", () => {
    const pts = resample(
      [
        [0, 0],
        [1, 0],
      ],
      5,
    );
    expect(pts.map((p) => p[0])).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("finds the minimum-cost assignment, including rectangular matrices", () => {
    expect(
      assign([
        [4, 1, 3],
        [2, 0, 5],
        [3, 2, 2],
      ]),
    ).toEqual([1, 0, 2]);
    expect(
      assign([
        [1, 9],
        [9, 1],
        [5, 5],
      ]),
    ).toEqual([0, 1, -1]);
    expect(assign([[9, 1, 9]])).toEqual([1]);
  });

  it("computes a longest increasing subsequence", () => {
    expect(longestIncreasingSubsequence([0, 2, 1, 3]).length).toBe(3);
    expect(longestIncreasingSubsequence([3, 2, 1]).length).toBe(1);
  });
});

describe("reference conversion", () => {
  it("maps Make Me a Hanzi coordinates into a y-down unit square", () => {
    const r = fromMakeMeAHanzi("x", [
      [
        [0, 900],
        [1024, -124],
      ],
    ]);
    expect(r.medians[0]![0]).toEqual([0, 0]);
    expect(r.medians[0]![1]).toEqual([1, 1]);
  });
});

/**
 * Validation sweep over every character in the HSK 1 starter set (102 characters),
 * using synthetic handwriting. Thresholds below are the acceptance criteria.
 */
describe("synthetic validation over the HSK 1 starter set", () => {
  it("accepts correctly written characters (with jitter, wobble, scale, offset, rotation)", () => {
    const failures: string[] = [];
    REFERENCES.forEach((r, i) => {
      const ink = toInk(variants.correct(r), {
        seed: i + 1,
        scale: 0.6 + (i % 5) * 0.1,
        offset: [((i % 3) - 1) * 0.08, ((i % 4) - 1.5) * 0.05],
        rotation: ((i % 5) - 2) * 0.02,
      });
      const result = evaluate(ink, r);
      if (!result.identity.verified || (result.band !== "EXCELLENT" && result.band !== "GOOD")) {
        failures.push(`${r.hanzi}:${result.band}:${result.identity.bestMatch}:${result.score}`);
      }
    });
    expect(failures).toEqual([]);
  });

  it("is independent of writing size and speed", () => {
    const r = ref("你");
    const small = evaluate(toInk(r.medians, { seed: 3, scale: 0.3, msPerPoint: 2 }), r);
    const large = evaluate(toInk(r.medians, { seed: 3, scale: 1.0, msPerPoint: 60 }), r);
    expect(small.identity.verified).toBe(true);
    expect(large.identity.verified).toBe(true);
    expect(Math.abs(small.score - large.score)).toBeLessThanOrEqual(3);
  });

  it("rejects a different character written instead of the expected one", () => {
    const misses: string[] = [];
    REFERENCES.forEach((expected, i) => {
      const other = REFERENCES[(i + 37) % REFERENCES.length]!;
      const result = evaluate(toInk(other.medians, { seed: i + 7 }), expected);
      if (result.identity.verified || result.band !== "TRY_AGAIN")
        misses.push(`${other.hanzi}→${expected.hanzi}`);
    });
    expect(misses).toEqual([]);
  });

  it("distinguishes visually similar pairs", () => {
    const pairs: [string, string][] = [
      ["他", "她"],
      ["人", "八"],
      ["人", "儿"],
      ["上", "下"],
      ["天", "大" in Object.fromEntries(REFERENCES.map((r) => [r.hanzi, 1])) ? "大" : "夫"],
      ["午", "年"],
      ["日", "月"].every((h) => REFERENCES.some((r) => r.hanzi === h))
        ? ["日", "月"]
        : ["今", "个"],
      ["己", "已"].every((h) => REFERENCES.some((r) => r.hanzi === h))
        ? ["己", "已"]
        : ["没", "汉"],
    ].filter(
      ([a, b]) => REFERENCES.some((r) => r.hanzi === a) && REFERENCES.some((r) => r.hanzi === b),
    ) as [string, string][];
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    for (const [a, b] of pairs) {
      const result = evaluate(toInk(ref(a).medians, { seed: 11 }), ref(b));
      expect(result.identity.verified, `${a} written, ${b} expected`).toBe(false);
      expect(result.identity.bestMatch).toBe(a);
    }
  });

  it("flags a missing stroke and caps the result", () => {
    const flagged: string[] = [];
    const multi = REFERENCES.filter((r) => r.medians.length >= 4);
    multi.forEach((r, i) => {
      const ink = toInk(variants.missingStroke(r, longestStroke(r)), { seed: i + 3 });
      const result = evaluate(ink, r);
      const ok =
        result.band !== "EXCELLENT" &&
        result.band !== "GOOD" &&
        (result.feedback.some((f) => f.code === "MISSING_STROKES") || !result.identity.verified);
      if (!ok) flagged.push(`${r.hanzi}:${result.band}`);
    });
    expect(flagged).toEqual([]);
  });

  it("flags an extra stroke", () => {
    const r = ref("国");
    const result = evaluate(toInk(variants.extraStroke(r), { seed: 5 }), r);
    expect(result.strokeCount.actual).toBe(r.medians.length + 1);
    expect(result.feedback.some((f) => f.code === "EXTRA_STROKES")).toBe(true);
    expect(["NEEDS_IMPROVEMENT", "TRY_AGAIN"]).toContain(result.band);
  });

  it("detects a reversed stroke direction on the longest stroke", () => {
    const misses: string[] = [];
    REFERENCES.forEach((r, i) => {
      const target = longestStroke(r);
      const result = evaluate(toInk(variants.reversed(r, target), { seed: i + 21 }), r);
      const flagged = result.feedback.some(
        (f) => f.code === "STROKE_DIRECTION" && f.stroke === target + 1,
      );
      if (!flagged) misses.push(`${r.hanzi}:${result.band}`);
    });
    // Direction detection is required on at least 95% of characters (synthetic).
    expect(misses.length / REFERENCES.length).toBeLessThanOrEqual(0.05);
  });

  it("detects wrong stroke order", () => {
    const misses: string[] = [];
    const multi = REFERENCES.filter((r) => r.medians.length >= 3);
    multi.forEach((r, i) => {
      const last = r.medians.length - 1;
      const result = evaluate(toInk(variants.swapped(r, 0, last), { seed: i + 41 }), r);
      const flagged = result.feedback.some((f) => f.code === "STROKE_ORDER");
      if (!flagged || result.band === "EXCELLENT") misses.push(`${r.hanzi}:${result.band}`);
    });
    expect(misses.length / multi.length).toBeLessThanOrEqual(0.05);
  });

  it("reports poorly proportioned strokes", () => {
    const r = ref("好");
    const result = evaluate(toInk(variants.distorted(r, longestStroke(r)), { seed: 9 }), r);
    expect(result.band).not.toBe("EXCELLENT");
    expect(result.dimensions.shape).toBeLessThan(0.85);
  });

  it("tolerates handwriting variation (heavier wobble) without changing identity", () => {
    const failures: string[] = [];
    REFERENCES.forEach((r, i) => {
      const result = evaluate(toInk(r.medians, { seed: i + 99, wobble: 0.025, jitter: 0.012 }), r);
      if (!result.identity.verified) failures.push(r.hanzi);
    });
    expect(failures.length / REFERENCES.length).toBeLessThanOrEqual(0.03);
  });
});

describe("result contract", () => {
  it("returns TRY_AGAIN with an EMPTY message for blank input", () => {
    const result = evaluateCharacter([], ref("你"));
    expect(result.band).toBe("TRY_AGAIN");
    expect(result.feedback[0]!.code).toBe("EMPTY");
  });

  it("never passes a wrong character even with perfect geometry elsewhere", () => {
    const result = evaluate(toInk(ref("她").medians, { seed: 2, jitter: 0, wobble: 0 }), ref("他"));
    expect(result.band).toBe("TRY_AGAIN");
    expect(result.dimensions.recognition).toBe(0);
  });

  it("scores are integers and dimensions are rounded", () => {
    const result = evaluate(toInk(ref("我").medians, { seed: 4 }), ref("我"));
    expect(Number.isInteger(result.score)).toBe(true);
    for (const v of Object.values(result.dimensions))
      expect(Math.round(v * 100)).toBeCloseTo(v * 100, 6);
  });

  it("evaluates multi-character words; the weakest character sets the band", () => {
    const ni = ref("你");
    const hao = ref("好");
    const good = evaluateWord(
      [toInk(ni.medians, { seed: 1 }), toInk(hao.medians, { seed: 2 })],
      [ni, hao],
      {
        candidates: REFERENCES,
      },
    );
    expect(good.expected).toBe("你好");
    expect(["EXCELLENT", "GOOD"]).toContain(good.band);
    const bad = evaluateWord([toInk(ni.medians, { seed: 1 }), []], [ni, hao], {
      candidates: REFERENCES,
    });
    expect(bad.band).toBe("TRY_AGAIN");
  });
});

describe("technique verdict", () => {
  it("judges reversed strokes as a technique fault, not a failed recall", () => {
    let faults = 0;
    REFERENCES.forEach((r, i) => {
      const result = evaluate(toInk(variants.reversed(r, longestStroke(r)), { seed: i + 21 }), r);
      if (isRecall(result) && techniqueVerdict(result) === false) faults += 1;
    });
    expect(faults / REFERENCES.length).toBeGreaterThanOrEqual(0.9);
  });

  it("gives clean writing a clean verdict and wrong characters no verdict", () => {
    const r = ref("你");
    const clean = evaluate(toInk(r.medians, { seed: 3 }), r);
    expect(techniqueVerdict(clean)).toBe(true);
    expect(techniqueNote(clean)).toBeNull();
    const wrong = evaluate(toInk(ref("她").medians, { seed: 2 }), ref("他"));
    expect(isRecall(wrong)).toBe(false);
    expect(techniqueVerdict(wrong)).toBeNull();
  });
});
