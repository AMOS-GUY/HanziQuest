/**
 * Verification levels and the rule that protects reviewed content (M7, D-038).
 *
 * Characters and words are shared between curricula. An import (or any bulk change) may only
 * overwrite a shared record's reading or gloss when it carries at least the record's own
 * verification level: a PROVISIONAL file can't silently rewrite a teacher-REVIEWED or
 * VERIFIED gloss while the record keeps its label.
 */
export type Verification = "PROVISIONAL" | "REVIEWED" | "VERIFIED";

export const VERIFICATION_RANK: Record<Verification, number> = {
  PROVISIONAL: 0,
  REVIEWED: 1,
  VERIFIED: 2,
};

export function mayOverwrite(existing: Verification, incoming: Verification) {
  return VERIFICATION_RANK[incoming] >= VERIFICATION_RANK[existing];
}

/** Learner-facing label. Only VERIFIED content may be presented as verified. */
export function verificationLabel(v: Verification) {
  return v === "VERIFIED"
    ? "Verified"
    : v === "REVIEWED"
      ? "Reviewed (not yet verified)"
      : "Provisional content";
}
