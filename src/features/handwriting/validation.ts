/**
 * Real-handwriting validation metrics (docs/HANDWRITING_VALIDATION.md).
 *
 * A sample is "accepted" when the engine grades it EXCELLENT or GOOD, the bands that count as
 * a successful independent recall for mastery. Two error rates matter:
 *  - False acceptance rate (FAR): accepted samples among those that should be rejected
 *    (wrong character, missing or extra stroke, wrong direction or order, poor shape).
 *  - False rejection rate (FRR): rejected samples among correctly written ones.
 * "Detected" means the engine also gave the specific feedback for the deliberate error.
 */
import { evaluateCharacter } from "./evaluate";
import type { CharacterEvaluation, InkStroke, ReferenceCharacter } from "./types";

export const SAMPLE_CATEGORIES = [
  "CORRECT",
  "WRONG_CHARACTER",
  "MISSING_STROKE",
  "EXTRA_STROKE",
  "WRONG_DIRECTION",
  "WRONG_ORDER",
  "POOR_SHAPE",
] as const;
export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<SampleCategory, string> = {
  CORRECT: "Correct, written normally",
  WRONG_CHARACTER: "A different character",
  MISSING_STROKE: "One stroke left out",
  EXTRA_STROKE: "One extra stroke",
  WRONG_DIRECTION: "A stroke drawn backwards",
  WRONG_ORDER: "Strokes in the wrong order",
  POOR_SHAPE: "Badly proportioned / placed",
};

/** Errors that make the answer structurally wrong (not the right character, as written). */
export const STRUCTURAL_ERRORS: readonly SampleCategory[] = [
  "WRONG_CHARACTER",
  "MISSING_STROKE",
  "EXTRA_STROKE",
];
/**
 * Technique errors: the right character with a stroke-direction, stroke-order or proportion
 * fault. By design (hq-eval-1) these are capped at GOOD with specific feedback, so they still
 * count as a recall; whether they should is a policy question for the real-data study.
 */
export const TECHNIQUE_ERRORS: readonly SampleCategory[] = [
  "WRONG_DIRECTION",
  "WRONG_ORDER",
  "POOR_SHAPE",
];

/** Ground truth: only correctly written characters should be accepted. */
export function shouldAccept(category: SampleCategory) {
  return category === "CORRECT";
}

export function isAccepted(evaluation: Pick<CharacterEvaluation, "band">) {
  return evaluation.band === "EXCELLENT" || evaluation.band === "GOOD";
}

/** Did the engine report the specific error the sample contains? */
export function isDetected(
  category: SampleCategory,
  evaluation: Pick<CharacterEvaluation, "band" | "feedback" | "identity">,
) {
  const has = (code: string) => evaluation.feedback.some((f) => f.code === code);
  switch (category) {
    case "CORRECT":
      return isAccepted(evaluation);
    case "WRONG_CHARACTER":
      return !evaluation.identity.verified;
    case "MISSING_STROKE":
      return has("MISSING_STROKES") || !evaluation.identity.verified;
    case "EXTRA_STROKE":
      return has("EXTRA_STROKES") || !evaluation.identity.verified;
    case "WRONG_DIRECTION":
      return has("STROKE_DIRECTION");
    case "WRONG_ORDER":
      return has("STROKE_ORDER");
    case "POOR_SHAPE":
      return has("STROKE_SHAPE") || evaluation.band !== "EXCELLENT";
  }
}

export interface ScoredSample {
  category: SampleCategory;
  accepted: boolean;
  detected: boolean;
  band: string;
  /** Optional grouping keys for breakdowns. */
  participant?: string;
  inputDevice?: string | null;
  sizeBucket?: string | null;
}

export function scoreSample(
  sample: { category: SampleCategory; strokes: InkStroke[] },
  expected: ReferenceCharacter,
  candidates: readonly ReferenceCharacter[],
) {
  const evaluation = evaluateCharacter(sample.strokes, expected, { candidates });
  return {
    evaluation,
    accepted: isAccepted(evaluation),
    detected: isDetected(sample.category, evaluation),
  };
}

/** Bucket by how much of the writing box the ink covers (larger side, 0–1). */
export function sizeBucket(strokes: InkStroke[]): string | null {
  const pts = strokes.flatMap((s) => s.points);
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (extent < 0.35) return "small (<35% of box)";
  if (extent < 0.7) return "medium (35–70%)";
  return "large (≥70%)";
}

interface Rate {
  numerator: number;
  denominator: number;
  rate: number | null;
}

const rate = (numerator: number, denominator: number): Rate => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

export interface ValidationMetrics {
  total: number;
  /** Strict: any deliberate error graded Good or Excellent. */
  falseAcceptance: Rate;
  /** Wrong character, missing or extra stroke graded Good or Excellent. */
  structuralFalseAcceptance: Rate;
  /** Direction, order or shape errors graded Good or Excellent (currently by design). */
  techniqueAcceptance: Rate;
  /** Deliberate errors for which the engine named the specific problem. */
  errorNamed: Rate;
  falseRejection: Rate;
  byCategory: { category: SampleCategory; total: number; accepted: Rate; detected: Rate }[];
  breakdowns: Record<
    "inputDevice" | "sizeBucket" | "participant",
    { key: string; far: Rate; frr: Rate }[]
  >;
  /** Plain-language warnings, e.g. too few samples to conclude anything. */
  warnings: string[];
}

export const MIN_SAMPLES = { correct: 300, incorrect: 300, participants: 15 } as const;

export function computeMetrics(samples: readonly ScoredSample[]): ValidationMetrics {
  const negatives = samples.filter((s) => !shouldAccept(s.category));
  const positives = samples.filter((s) => shouldAccept(s.category));
  const group = (key: "inputDevice" | "sizeBucket" | "participant") => {
    const keys = [...new Set(samples.map((s) => s[key] ?? "unknown"))].sort();
    return keys.map((k) => {
      const inGroup = samples.filter((s) => (s[key] ?? "unknown") === k);
      const neg = inGroup.filter((s) => !shouldAccept(s.category));
      const pos = inGroup.filter((s) => shouldAccept(s.category));
      return {
        key: k,
        far: rate(neg.filter((s) => s.accepted).length, neg.length),
        frr: rate(pos.filter((s) => !s.accepted).length, pos.length),
      };
    });
  };
  const participants = new Set(samples.map((s) => s.participant ?? "unknown")).size;
  const warnings: string[] = [];
  if (positives.length < MIN_SAMPLES.correct)
    warnings.push(
      `Only ${positives.length} correct samples; at least ${MIN_SAMPLES.correct} are needed before tuning.`,
    );
  if (negatives.length < MIN_SAMPLES.incorrect)
    warnings.push(
      `Only ${negatives.length} deliberately incorrect samples; at least ${MIN_SAMPLES.incorrect} are needed.`,
    );
  if (participants < MIN_SAMPLES.participants)
    warnings.push(
      `Samples come from ${participants} participant(s); at least ${MIN_SAMPLES.participants} are needed.`,
    );
  const structural = samples.filter((s) => STRUCTURAL_ERRORS.includes(s.category));
  const technique = samples.filter((s) => TECHNIQUE_ERRORS.includes(s.category));
  return {
    total: samples.length,
    falseAcceptance: rate(negatives.filter((s) => s.accepted).length, negatives.length),
    structuralFalseAcceptance: rate(structural.filter((s) => s.accepted).length, structural.length),
    techniqueAcceptance: rate(technique.filter((s) => s.accepted).length, technique.length),
    errorNamed: rate(negatives.filter((s) => s.detected).length, negatives.length),
    falseRejection: rate(positives.filter((s) => !s.accepted).length, positives.length),
    byCategory: [...new Set(samples.map((s) => s.category))].sort().map((category) => {
      const inCat = samples.filter((s) => s.category === category);
      return {
        category,
        total: inCat.length,
        accepted: rate(inCat.filter((s) => s.accepted).length, inCat.length),
        detected: rate(inCat.filter((s) => s.detected).length, inCat.length),
      };
    }),
    breakdowns: {
      inputDevice: group("inputDevice"),
      sizeBucket: group("sizeBucket"),
      participant: group("participant"),
    },
    warnings,
  };
}

export function formatRate(r: Rate) {
  return r.rate === null
    ? "n/a"
    : `${(r.rate * 100).toFixed(1)}% (${r.numerator}/${r.denominator})`;
}
