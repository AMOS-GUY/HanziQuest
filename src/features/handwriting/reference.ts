import type { ReferenceCharacter, Vec } from "./types";

/**
 * Converts Make Me a Hanzi / hanzi-writer-data medians (1024-unit grid, y axis pointing up,
 * top edge at y = 900) to the engine's normalised space (unit square, y pointing down).
 */
export function fromMakeMeAHanzi(
  hanzi: string,
  medians: readonly (readonly (readonly number[])[])[],
): ReferenceCharacter {
  return {
    hanzi,
    medians: medians.map((stroke) => stroke.map(([x, y]) => [x! / 1024, (900 - y!) / 1024] as Vec)),
  };
}
