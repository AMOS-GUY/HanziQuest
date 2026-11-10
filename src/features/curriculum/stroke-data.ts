import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Reference stroke data from hanzi-writer-data (derived from Make Me a Hanzi).
 * Coordinates are in a 1024-unit grid with the y axis pointing UP (y = 900 is the top edge).
 */
export interface StrokeData {
  strokes: string[];
  medians: [number, number][][];
}

let dataDir: string | null = null;

function resolveDataDir(): string {
  if (!dataDir) {
    const require = createRequire(import.meta.url);
    dataDir = path.dirname(require.resolve("hanzi-writer-data/package.json"));
  }
  return dataDir;
}

/** Loads stroke data for a character, or null if unavailable. Server/script use only. */
export function loadStrokeData(hanzi: string): StrokeData | null {
  if ([...hanzi].length !== 1) return null;
  const file = path.join(resolveDataDir(), `${hanzi}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StrokeData>;
  if (!Array.isArray(raw.strokes) || !Array.isArray(raw.medians)) return null;
  if (raw.strokes.length === 0 || raw.strokes.length !== raw.medians.length) return null;
  return { strokes: raw.strokes, medians: raw.medians };
}
