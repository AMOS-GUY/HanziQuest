/**
 * Handwriting engine types. All coordinates are NORMALISED to a unit square:
 * x and y in [0, 1], origin at the top-left, y pointing DOWN (same as the canvas).
 */
export type Vec = readonly [number, number];

/** A captured point. `t` is milliseconds since the start of the drawing. */
export interface InkPoint {
  x: number;
  y: number;
  t: number;
}

/** One pen-down → pen-up stroke, in drawing order. */
export interface InkStroke {
  points: InkPoint[];
}

/** Reference geometry for one character: stroke medians in canonical stroke order. */
export interface ReferenceCharacter {
  hanzi: string;
  medians: Vec[][];
}

export type EvaluationBand = "EXCELLENT" | "GOOD" | "NEEDS_IMPROVEMENT" | "TRY_AGAIN";

export type FeedbackCode =
  | "EMPTY"
  | "WRONG_CHARACTER"
  | "MISSING_STROKES"
  | "EXTRA_STROKES"
  | "STROKE_ORDER"
  | "STROKE_DIRECTION"
  | "STROKE_SHAPE";

export interface FeedbackItem {
  code: FeedbackCode;
  /** 1-based reference stroke number the message refers to, when applicable. */
  stroke?: number;
  message: string;
}

export interface StrokeMatch {
  /** Index of the learner's stroke (drawing order). */
  userStroke: number;
  /** Index of the matched reference stroke, or null when the stroke matched nothing. */
  referenceStroke: number | null;
  reversed: boolean;
  /** 0–1 shape/position quality of this match. */
  quality: number;
}

export interface Dimensions {
  /** 1 when the character identity was verified against the candidate set, else 0. */
  recognition: number;
  strokeOrder: number;
  direction: number;
  shape: number;
}

export interface CharacterEvaluation {
  engineVersion: string;
  hanzi: string;
  identity: {
    verified: boolean;
    /** The candidate the drawing resembles most (may differ from `hanzi`). */
    bestMatch: string | null;
    /** How many characters the drawing was compared against. */
    candidateCount: number;
  };
  strokeCount: { expected: number; actual: number };
  dimensions: Dimensions;
  /** 0–100, rounded to an integer. Present to learners as a band, not as a precise number. */
  score: number;
  band: EvaluationBand;
  feedback: FeedbackItem[];
  matches: StrokeMatch[];
}

export interface WordEvaluation {
  engineVersion: string;
  expected: string;
  characters: CharacterEvaluation[];
  score: number;
  band: EvaluationBand;
}
