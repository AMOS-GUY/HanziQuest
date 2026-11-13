/**
 * Synthetic handwriting generator for engine tests. Produces learner-like ink from reference
 * medians with controlled distortions. This is NOT real handwriting; see docs/HANDWRITING.md.
 */
import type { ReferenceCharacter, Vec } from "@/features/handwriting/types";

// The generator lives in src so server-side diagnostics (M13) can use it.
export { rng, toInk, type InkOptions } from "@/features/handwriting/synthetic-ink";

export const variants = {
  correct: (ref: ReferenceCharacter) => ref.medians,
  missingStroke: (ref: ReferenceCharacter, index: number) =>
    ref.medians.filter((_, i) => i !== index),
  extraStroke: (ref: ReferenceCharacter) => [
    ...ref.medians,
    [
      [0.15, 0.85],
      [0.85, 0.15],
    ] as Vec[],
  ],
  reversed: (ref: ReferenceCharacter, index: number) =>
    ref.medians.map((s, i) => (i === index ? [...s].reverse() : s)),
  swapped: (ref: ReferenceCharacter, a: number, b: number) =>
    ref.medians.map((s, i) => (i === a ? ref.medians[b]! : i === b ? ref.medians[a]! : s)),
  /** Stretches one stroke 1.8× about its centre and shifts it — a badly proportioned stroke. */
  distorted: (ref: ReferenceCharacter, index: number) =>
    ref.medians.map((s, i) => {
      if (i !== index) return s;
      const cx = s.reduce((t, p) => t + p[0], 0) / s.length;
      const cy = s.reduce((t, p) => t + p[1], 0) / s.length;
      return s.map(([x, y]) => [cx + (x - cx) * 1.8 + 0.12, cy + (y - cy) * 1.8 + 0.12] as Vec);
    }),
};

/** Index of the longest stroke (the most reliable one for direction tests). */
export function longestStroke(ref: ReferenceCharacter): number {
  let best = 0;
  let bestLen = -1;
  ref.medians.forEach((s, i) => {
    let len = 0;
    for (let k = 1; k < s.length; k += 1)
      len += Math.hypot(s[k]![0] - s[k - 1]![0], s[k]![1] - s[k - 1]![1]);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  });
  return best;
}
