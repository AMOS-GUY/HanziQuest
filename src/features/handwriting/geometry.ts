import type { Vec } from "./types";

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function pathLength(points: readonly Vec[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!);
  return total;
}

/** Resamples a polyline to `n` points evenly spaced along its arc length. */
export function resample(points: readonly Vec[], n: number): Vec[] {
  if (points.length === 0) return [];
  const total = pathLength(points);
  if (points.length === 1 || total === 0) return Array.from({ length: n }, () => points[0]!);

  const step = total / (n - 1);
  const result: Vec[] = [points[0]!];
  let carried = 0;
  for (let i = 1; i < points.length && result.length < n; i += 1) {
    let prev = points[i - 1]!;
    const curr = points[i]!;
    let segment = distance(prev, curr);
    while (carried + segment >= step && result.length < n) {
      const ratio = (step - carried) / segment;
      const point: Vec = [
        prev[0] + ratio * (curr[0] - prev[0]),
        prev[1] + ratio * (curr[1] - prev[1]),
      ];
      result.push(point);
      segment -= step - carried;
      prev = point;
      carried = 0;
    }
    carried += segment;
  }
  while (result.length < n) result.push(points[points.length - 1]!);
  return result;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundingBox(strokes: readonly (readonly Vec[])[]): Box | null {
  let box: Box | null = null;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
      else {
        box.minX = Math.min(box.minX, x);
        box.minY = Math.min(box.minY, y);
        box.maxX = Math.max(box.maxX, x);
        box.maxY = Math.max(box.maxY, y);
      }
    }
  }
  return box;
}

/**
 * Centres strokes on their bounding box and scales uniformly so the larger side is 1.
 * Makes comparison independent of writing size and position while preserving proportions.
 */
export function normalizeStrokes(strokes: readonly (readonly Vec[])[]): Vec[][] {
  const box = boundingBox(strokes);
  if (!box) return [];
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1e-6);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return strokes.map((stroke) => stroke.map(([x, y]) => [(x - cx) / size, (y - cy) / size] as Vec));
}

/** Indices of one longest strictly increasing subsequence. */
export function longestIncreasingSubsequence(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const lengths = new Array<number>(n).fill(1);
  const previous = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (values[j]! < values[i]! && lengths[j]! + 1 > lengths[i]!) {
        lengths[i] = lengths[j]! + 1;
        previous[i] = j;
      }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i += 1) if (lengths[i]! > lengths[end]!) end = i;
  const result: number[] = [];
  for (let i = end; i !== -1; i = previous[i]!) result.push(i);
  return result.reverse();
}

/**
 * Minimum-cost assignment (Hungarian algorithm) for a rectangular cost matrix.
 * Returns, for each row, the assigned column or -1.
 */
export function assign(cost: readonly (readonly number[])[]): number[] {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : cost[0]!.length;
  const n = Math.max(rows, cols);
  if (n === 0) return [];
  const PAD = 1e6;
  const a = (i: number, j: number) => (i < rows && j < cols ? cost[i]![j]! : PAD);

  // 1-indexed implementation (e-maxx).
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = a(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= n; j += 1) {
    const i = p[j]! - 1;
    if (i >= 0 && i < rows && j - 1 < cols) result[i] = j - 1;
  }
  return result;
}
