/**
 * Seeded SYNTHETIC ink (M13). Turns reference stroke medians into learner-like ink with
 * controlled, reproducible distortions (jitter, wobble, scale, offset, rotation, speed).
 *
 * This is NOT human handwriting. Results computed on it are regression and diagnostic
 * evidence about the engine's behaviour only, never evidence of accuracy with real learners
 * (docs/HANDWRITING.md, docs/M13_HANDWRITING_DIAGNOSTICS.md). Moved here from
 * tests/support/handwriting-fixtures.ts so server-side diagnostics can use it; the tests
 * re-export it unchanged.
 */
import type { InkStroke, Vec } from "./types";
import { resample } from "./geometry";

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
