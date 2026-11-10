/**
 * Synthetic handwriting generator for engine tests. Produces learner-like ink from reference
 * medians with controlled distortions. This is NOT real handwriting; see docs/HANDWRITING.md.
 */
import type { InkStroke, ReferenceCharacter, Vec } from "@/features/handwriting/types";
import { resample } from "@/features/handwriting/geometry";

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface InkOptions {
  seed?: number;
  /** Point jitter (normalised units). */
  jitter?: number;
  /** Smooth low-frequency wobble amplitude, imitating unsteady handwriting. */
  wobble?: number;
  /** Uniform scale of the whole character about the box centre. */
  scale?: number;
  /** Translation of the whole character. */
  offset?: Vec;
  /** Small rotation in radians. */
  rotation?: number;
  /** Milliseconds per point (writing speed). */
  msPerPoint?: number;
  /** Points per stroke. */
  pointsPerStroke?: number;
}

/** Turns stroke polylines into timestamped ink with realistic distortions. */
export function toInk(strokes: readonly (readonly Vec[])[], options: InkOptions = {}): InkStroke[] {
  const rand = rng(options.seed ?? 1);
  const jitter = options.jitter ?? 0.008;
  const wobble = options.wobble ?? 0.01;
  const scale = options.scale ?? 1;
  const [ox, oy] = options.offset ?? [0, 0];
  const rot = options.rotation ?? 0;
  const msPerPoint = options.msPerPoint ?? 12;
  const n = options.pointsPerStroke ?? 24;
  let t = 0;

  return strokes.map((stroke) => {
    const phase = rand() * Math.PI * 2;
    const points = resample(stroke, n).map(([x, y], i) => {
      const w = wobble * Math.sin(phase + (i / n) * Math.PI * 2);
      let px = x - 0.5 + w + gaussian(rand) * jitter;
      let py = y - 0.5 + w * 0.6 + gaussian(rand) * jitter;
      [px, py] = [px * Math.cos(rot) - py * Math.sin(rot), px * Math.sin(rot) + py * Math.cos(rot)];
      t += msPerPoint;
      return { x: 0.5 + px * scale + ox, y: 0.5 + py * scale + oy, t };
    });
    t += 150; // pen lift
    return { points };
  });
}

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
