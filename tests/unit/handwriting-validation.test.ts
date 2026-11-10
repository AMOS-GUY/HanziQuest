import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  isDetected,
  MIN_SAMPLES,
  sizeBucket,
  type ScoredSample,
} from "@/features/handwriting/validation";

const s = (
  category: ScoredSample["category"],
  accepted: boolean,
  extra: Partial<ScoredSample> = {},
) =>
  ({
    category,
    accepted,
    detected: !accepted,
    band: accepted ? "GOOD" : "TRY_AGAIN",
    ...extra,
  }) as ScoredSample;

describe("validation metrics", () => {
  it("computes false acceptance and rejection with clear denominators", () => {
    const m = computeMetrics([
      s("CORRECT", true),
      s("CORRECT", true),
      s("CORRECT", false),
      s("WRONG_CHARACTER", false),
      s("MISSING_STROKE", true),
      s("WRONG_DIRECTION", true, { detected: true }),
    ]);
    expect(m.falseRejection).toMatchObject({ numerator: 1, denominator: 3 });
    expect(m.structuralFalseAcceptance).toMatchObject({ numerator: 1, denominator: 2 });
    expect(m.techniqueAcceptance).toMatchObject({ numerator: 1, denominator: 1 });
    expect(m.falseAcceptance).toMatchObject({ numerator: 2, denominator: 3 });
  });

  it("warns when the sample is too small to tune thresholds", () => {
    const m = computeMetrics([s("CORRECT", true, { participant: "P1" })]);
    expect(m.warnings.join(" ")).toContain(String(MIN_SAMPLES.correct));
    expect(m.warnings.join(" ")).toContain(String(MIN_SAMPLES.participants));
  });

  it("reports n/a rather than 0% when a group is empty", () => {
    expect(computeMetrics([]).falseRejection.rate).toBeNull();
  });

  it("breaks results down by device and size", () => {
    const m = computeMetrics([
      s("CORRECT", false, { inputDevice: "finger" }),
      s("CORRECT", true, { inputDevice: "stylus" }),
    ]);
    expect(m.breakdowns.inputDevice.find((b) => b.key === "finger")!.frr.rate).toBe(1);
    expect(m.breakdowns.inputDevice.find((b) => b.key === "stylus")!.frr.rate).toBe(0);
  });

  it("checks for the specific feedback for each deliberate error", () => {
    const base = {
      band: "GOOD" as const,
      identity: { verified: true, bestMatch: "x", candidateCount: 1 },
    };
    expect(
      isDetected("WRONG_DIRECTION", {
        ...base,
        feedback: [{ code: "STROKE_DIRECTION", message: "" }],
      }),
    ).toBe(true);
    expect(isDetected("WRONG_ORDER", { ...base, feedback: [] })).toBe(false);
    expect(
      isDetected("WRONG_CHARACTER", {
        ...base,
        identity: { ...base.identity, verified: false },
        feedback: [],
      }),
    ).toBe(true);
  });

  it("buckets writing size by how much of the box is used", () => {
    const stroke = (a: number, b: number) => ({
      points: [
        { x: a, y: a, t: 0 },
        { x: b, y: b, t: 1 },
      ],
    });
    expect(sizeBucket([stroke(0.4, 0.6)])).toMatch(/^small/);
    expect(sizeBucket([stroke(0.1, 0.9)])).toMatch(/^large/);
    expect(sizeBucket([])).toBeNull();
  });
});
