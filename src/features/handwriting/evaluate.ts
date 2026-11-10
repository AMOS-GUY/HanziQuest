import type { EvaluationWeights } from "@/features/exercises/evaluation-config";
import { DEFAULT_EVALUATION_WEIGHTS } from "@/features/exercises/evaluation-config";
import {
  assign,
  distance,
  longestIncreasingSubsequence,
  normalizeStrokes,
  pathLength,
  resample,
} from "./geometry";
import type {
  CharacterEvaluation,
  EvaluationBand,
  FeedbackItem,
  InkStroke,
  ReferenceCharacter,
  StrokeMatch,
  Vec,
  WordEvaluation,
} from "./types";

export const ENGINE_VERSION = "hq-eval-1";

/**
 * Tunable thresholds. EXPERIMENTAL: calibrated on synthetic handwriting only (see docs/HANDWRITING.md).
 * Distances are in normalised character units (the character's larger side = 1).
 */
export const THRESHOLDS = {
  samplesPerStroke: 16,
  /** A stroke pair costing more than this is treated as "not the same stroke". */
  unmatchedCost: 0.3,
  /** Cost charged per unmatched stroke when comparing whole characters. */
  unmatchedPenalty: 0.35,
  /** Shape quality falls linearly from 1 (cost 0) to 0 (cost = shapeScale). */
  shapeScale: 0.3,
  /** Below this quality a stroke gets specific shape feedback. */
  poorShapeQuality: 0.45,
  /** Reverse direction must beat forward by this factor to count as reversed. */
  reverseMargin: 0.75,
  /** Reference strokes shorter than this (dots) are exempt from direction checks. */
  minDirectionalLength: 0.12,
  /** The expected character must score within this distance (and be the nearest candidate). */
  maxIdentityDistance: 0.2,
  /** Another candidate must beat the expected one by this margin to be called a different character. */
  identityMargin: 0.01,
  bands: { excellent: 88, good: 72, needsImprovement: 50 },
  /** Minimum overall shape quality for EXCELLENT / for GOOD. */
  shapeForExcellent: 0.8,
  shapeForGood: 0.55,
} as const;

interface PreparedCharacter {
  hanzi: string;
  strokes: Vec[][];
  lengths: number[];
}

function prepare(hanzi: string, strokes: readonly (readonly Vec[])[]): PreparedCharacter {
  const normalized = normalizeStrokes(strokes);
  return {
    hanzi,
    strokes: normalized.map((s) => resample(s, THRESHOLDS.samplesPerStroke)),
    lengths: normalized.map((s) => pathLength(s)),
  };
}

const preparedCache = new Map<string, PreparedCharacter>();

function prepareReference(ref: ReferenceCharacter): PreparedCharacter {
  const key = `${ref.hanzi}:${ref.medians.length}`;
  let cached = preparedCache.get(key);
  if (!cached) {
    cached = prepare(ref.hanzi, ref.medians);
    preparedCache.set(key, cached);
  }
  return cached;
}

function meanDistance(a: readonly Vec[], b: readonly Vec[], reverse: boolean): number {
  let total = 0;
  const n = a.length;
  for (let i = 0; i < n; i += 1) total += distance(a[i]!, b[reverse ? n - 1 - i : i]!);
  return total / n;
}

interface PairCost {
  cost: number;
  reversed: boolean;
}

function pairCost(user: readonly Vec[], ref: readonly Vec[], refLength: number): PairCost {
  const forward = meanDistance(user, ref, false);
  const backward = meanDistance(user, ref, true);
  const directional = refLength >= THRESHOLDS.minDirectionalLength;
  const reversed = directional && backward < forward * THRESHOLDS.reverseMargin;
  return { cost: Math.min(forward, backward), reversed };
}

interface Alignment {
  /** For each user stroke: matched reference index or null. */
  userToRef: (number | null)[];
  pairs: Map<number, PairCost>;
  /** Average cost per stroke including unmatched penalties; lower = more similar. */
  distance: number;
}

function align(user: PreparedCharacter, ref: PreparedCharacter): Alignment {
  const matrix = user.strokes.map((u) =>
    ref.strokes.map((r, j) => pairCost(u, r, ref.lengths[j]!)),
  );
  const assignment = assign(matrix.map((row) => row.map((c) => c.cost)));
  const userToRef: (number | null)[] = [];
  const pairs = new Map<number, PairCost>();
  let total = 0;
  let unmatched = 0;
  assignment.forEach((j, i) => {
    const pair = j >= 0 ? matrix[i]![j]! : null;
    if (pair && pair.cost <= THRESHOLDS.unmatchedCost) {
      userToRef.push(j);
      pairs.set(i, pair);
      total += pair.cost;
    } else {
      userToRef.push(null);
      unmatched += 1;
    }
  });
  const matchedRefs = new Set(userToRef.filter((j): j is number => j !== null));
  unmatched += ref.strokes.length - matchedRefs.size;
  const denominator = Math.max(user.strokes.length, ref.strokes.length, 1);
  return {
    userToRef,
    pairs,
    distance: (total + unmatched * THRESHOLDS.unmatchedPenalty) / denominator,
  };
}

function toBand(score: number): EvaluationBand {
  if (score >= THRESHOLDS.bands.excellent) return "EXCELLENT";
  if (score >= THRESHOLDS.bands.good) return "GOOD";
  if (score >= THRESHOLDS.bands.needsImprovement) return "NEEDS_IMPROVEMENT";
  return "TRY_AGAIN";
}

const BAND_ORDER: EvaluationBand[] = ["TRY_AGAIN", "NEEDS_IMPROVEMENT", "GOOD", "EXCELLENT"];
function capBand(band: EvaluationBand, cap: EvaluationBand): EvaluationBand {
  return BAND_ORDER.indexOf(band) > BAND_ORDER.indexOf(cap) ? cap : band;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function list(numbers: number[]): string {
  if (numbers.length === 1) return String(numbers[0]);
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

export interface EvaluateOptions {
  weights?: EvaluationWeights;
  /**
   * Characters to compare against for identity verification. The expected character is always
   * included. Identity is only "verified" relative to this set — not general recognition.
   */
  candidates?: readonly ReferenceCharacter[];
}

/** Evaluates one handwritten character against its reference. Pure and deterministic. */
export function evaluateCharacter(
  ink: readonly InkStroke[],
  expected: ReferenceCharacter,
  options: EvaluateOptions = {},
): CharacterEvaluation {
  const weights = options.weights ?? DEFAULT_EVALUATION_WEIGHTS;
  const strokes = ink
    .map((s) => s.points.map((p) => [p.x, p.y] as Vec))
    .filter((s) => s.length > 0);
  const expectedCount = expected.medians.length;
  const candidates = new Map<string, ReferenceCharacter>();
  for (const c of options.candidates ?? []) candidates.set(c.hanzi, c);
  candidates.set(expected.hanzi, expected);

  if (strokes.length === 0) {
    return {
      engineVersion: ENGINE_VERSION,
      hanzi: expected.hanzi,
      identity: { verified: false, bestMatch: null, candidateCount: candidates.size },
      strokeCount: { expected: expectedCount, actual: 0 },
      dimensions: { recognition: 0, strokeOrder: 0, direction: 0, shape: 0 },
      score: 0,
      band: "TRY_AGAIN",
      feedback: [{ code: "EMPTY", message: "Write the character in the box first." }],
      matches: [],
    };
  }

  const user = prepare(expected.hanzi, strokes);
  const reference = prepareReference(expected);
  const alignment = align(user, reference);

  // Identity: nearest candidate by whole-character distance.
  let bestMatch = expected.hanzi;
  let bestDistance = alignment.distance;
  for (const candidate of candidates.values()) {
    if (candidate.hanzi === expected.hanzi) continue;
    const d = align(user, prepareReference(candidate)).distance;
    if (d < bestDistance - THRESHOLDS.identityMargin) {
      bestDistance = d;
      bestMatch = candidate.hanzi;
    }
  }
  const verified =
    bestMatch === expected.hanzi && alignment.distance <= THRESHOLDS.maxIdentityDistance;

  // Per-stroke matches.
  const matches: StrokeMatch[] = alignment.userToRef.map((ref, i) => {
    const pair = alignment.pairs.get(i);
    return {
      userStroke: i,
      referenceStroke: ref,
      reversed: pair?.reversed ?? false,
      quality: pair ? round2(Math.max(0, 1 - pair.cost / THRESHOLDS.shapeScale)) : 0,
    };
  });
  const matched = matches.filter((m) => m.referenceStroke !== null);

  // Stroke order: longest run of matched strokes written in canonical order.
  const refSequence = matched.map((m) => m.referenceStroke!);
  const inOrder = new Set(longestIncreasingSubsequence(refSequence).map((i) => refSequence[i]!));
  const outOfOrder = refSequence
    .filter((r) => !inOrder.has(r))
    .map((r) => r + 1)
    .sort((a, b) => a - b);
  const strokeOrder = inOrder.size / expectedCount;

  // Direction.
  const reversedStrokes = matched
    .filter((m) => m.reversed)
    .map((m) => m.referenceStroke! + 1)
    .sort((a, b) => a - b);
  const direction = (matched.length - reversedStrokes.length) / expectedCount;

  // Shape: quality per reference stroke (0 when missing), discounted for extra strokes.
  const qualityByRef = new Map(matched.map((m) => [m.referenceStroke!, m.quality]));
  let shapeTotal = 0;
  for (let j = 0; j < expectedCount; j += 1) shapeTotal += qualityByRef.get(j) ?? 0;
  const extra = matches.length - matched.length;
  const shape = (shapeTotal / expectedCount) * (expectedCount / (expectedCount + extra));

  const recognition = verified ? 1 : 0;
  const raw =
    100 *
    (weights.recognition * recognition +
      weights.strokeOrder * strokeOrder +
      weights.direction * direction +
      weights.shape * shape);
  const score = Math.round(raw);

  // Band with evidence-based caps.
  let band = toBand(score);
  const missing = expectedCount - matched.length;
  if (!verified) band = "TRY_AGAIN";
  else if (missing > 0 || extra > 0) band = capBand(band, "NEEDS_IMPROVEMENT");
  else if (outOfOrder.length > 0 || reversedStrokes.length > 0) band = capBand(band, "GOOD");
  if (verified) {
    if (shape < THRESHOLDS.shapeForGood) band = capBand(band, "NEEDS_IMPROVEMENT");
    else if (
      shape < THRESHOLDS.shapeForExcellent ||
      matched.some((m) => m.quality < THRESHOLDS.poorShapeQuality)
    ) {
      band = capBand(band, "GOOD");
    }
  }

  // Feedback (only claims the engine has evidence for).
  const feedback: FeedbackItem[] = [];
  if (!verified) {
    feedback.push({
      code: "WRONG_CHARACTER",
      message:
        bestMatch !== expected.hanzi
          ? `This looks more like ${bestMatch} than ${expected.hanzi}.`
          : `This doesn't look like ${expected.hanzi} yet. Watch the stroke order and try again.`,
    });
  }
  if (strokes.length < expectedCount) {
    feedback.push({
      code: "MISSING_STROKES",
      message: `You wrote ${strokes.length} stroke${strokes.length === 1 ? "" : "s"}; ${expected.hanzi} has ${expectedCount}.`,
    });
  } else if (strokes.length > expectedCount) {
    feedback.push({
      code: "EXTRA_STROKES",
      message: `You wrote ${strokes.length} strokes; ${expected.hanzi} has only ${expectedCount}.`,
    });
  } else if (missing > 0) {
    feedback.push({
      code: "MISSING_STROKES",
      message: `${missing} stroke${missing === 1 ? " doesn't" : "s don't"} match any stroke of ${expected.hanzi}.`,
    });
  }
  if (verified) {
    if (outOfOrder.length > 0) {
      feedback.push({
        code: "STROKE_ORDER",
        stroke: outOfOrder[0],
        message: `Stroke${outOfOrder.length > 1 ? "s" : ""} ${list(outOfOrder)} ${outOfOrder.length > 1 ? "were" : "was"} written out of order.`,
      });
    }
    for (const stroke of reversedStrokes) {
      feedback.push({
        code: "STROKE_DIRECTION",
        stroke,
        message: `Stroke ${stroke} goes the wrong way. Start it from the other end.`,
      });
    }
    for (const m of matched) {
      if (m.quality < THRESHOLDS.poorShapeQuality) {
        feedback.push({
          code: "STROKE_SHAPE",
          stroke: m.referenceStroke! + 1,
          message: `Stroke ${m.referenceStroke! + 1} is off in shape or position.`,
        });
      }
    }
  }

  return {
    engineVersion: ENGINE_VERSION,
    hanzi: expected.hanzi,
    identity: { verified, bestMatch, candidateCount: candidates.size },
    strokeCount: { expected: expectedCount, actual: strokes.length },
    dimensions: {
      recognition,
      strokeOrder: round2(strokeOrder),
      direction: round2(direction),
      shape: round2(shape),
    },
    score,
    band,
    feedback,
    matches,
  };
}

/** Evaluates a multi-character answer (one drawing per character). The weakest character sets the band. */
export function evaluateWord(
  drawings: readonly (readonly InkStroke[])[],
  expected: readonly ReferenceCharacter[],
  options: EvaluateOptions = {},
): WordEvaluation {
  const characters = expected.map((ref, i) => evaluateCharacter(drawings[i] ?? [], ref, options));
  const score = Math.round(
    characters.reduce((t, c) => t + c.score, 0) / Math.max(characters.length, 1),
  );
  const band = characters.reduce<EvaluationBand>(
    (worst, c) => (BAND_ORDER.indexOf(c.band) < BAND_ORDER.indexOf(worst) ? c.band : worst),
    "EXCELLENT",
  );
  return {
    engineVersion: ENGINE_VERSION,
    expected: expected.map((r) => r.hanzi).join(""),
    characters,
    score,
    band,
  };
}
