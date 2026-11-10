/**
 * Recall vs writing technique (docs/HANDWRITING.md, "Mastery policy").
 *
 * - **Recall**: the learner produced the right character with the right strokes (identity
 *   verified, band EXCELLENT or GOOD). Recall drives the review schedule. A wrong character is
 *   never a recall.
 * - **Technique**: stroke order and stroke direction. They are judged only when recall
 *   succeeded in independent writing. A recall with an order or direction fault still counts
 *   as remembering the character, but not as correct technique: it earns reduced XP, brings
 *   the review back sooner, and keeps the character below MASTERED until the technique is
 *   clean.
 * Guided (traced) practice never counts for recall or technique.
 */
import type { CharacterEvaluation, FeedbackCode } from "./types";

export const TECHNIQUE_CODES: readonly FeedbackCode[] = ["STROKE_ORDER", "STROKE_DIRECTION"];

export function isRecall(evaluation: Pick<CharacterEvaluation, "band" | "identity">) {
  return (
    evaluation.identity.verified && (evaluation.band === "EXCELLENT" || evaluation.band === "GOOD")
  );
}

/**
 * true = correct order and direction; false = a technique fault; null = not judged
 * (recall failed, so technique says nothing).
 */
export function techniqueVerdict(
  evaluation: Pick<CharacterEvaluation, "band" | "identity" | "feedback">,
): boolean | null {
  if (!isRecall(evaluation)) return null;
  return !evaluation.feedback.some((f) => TECHNIQUE_CODES.includes(f.code));
}

/** A short learner-facing note explaining how this attempt counts. */
export function techniqueNote(
  evaluation: Pick<CharacterEvaluation, "band" | "identity" | "feedback">,
): string | null {
  const verdict = techniqueVerdict(evaluation);
  if (verdict === false)
    return "You remembered this character. Fix the stroke order or direction before it can count as mastered.";
  return null;
}
