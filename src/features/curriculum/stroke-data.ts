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

/**
 * Locates the dataset folder. Inside a bundled server (Next.js), `require.resolve` returns a
 * module id rather than a path, so fall back to node_modules under the working directory, or
 * HANZI_WRITER_DATA_DIR when the app runs from a different directory.
 */
function resolveDataDir(): string {
  if (dataDir) return dataDir;
  const candidates: string[] = [];
  if (process.env.HANZI_WRITER_DATA_DIR) candidates.push(process.env.HANZI_WRITER_DATA_DIR);
  try {
    const resolved: unknown = createRequire(import.meta.url).resolve(
      "hanzi-writer-data/package.json",
    );
    if (typeof resolved === "string") candidates.push(path.dirname(resolved));
  } catch {
    // not resolvable in this runtime
  }
  candidates.push(path.join(process.cwd(), "node_modules", "hanzi-writer-data"));
  dataDir =
    candidates.find((dir) => fs.existsSync(path.join(dir, "package.json"))) ?? candidates.at(-1)!;
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
