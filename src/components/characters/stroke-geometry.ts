/** Helpers for rendering Make Me a Hanzi stroke data (1024 grid, y up, top edge at 900). */

/** SVG transform that flips Make Me a Hanzi coordinates into a normal y-down 1024×1024 viewBox. */
export const MMAH_TRANSFORM = "translate(0, 900) scale(1, -1)";

export function medianPath(median: readonly (readonly number[])[]): string {
  return median.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
}

export function medianLength(median: readonly (readonly number[])[]): number {
  let total = 0;
  for (let i = 1; i < median.length; i += 1) {
    total += Math.hypot(median[i]![0]! - median[i - 1]![0]!, median[i]![1]! - median[i - 1]![1]!);
  }
  return total;
}
