import type { PrismaClient } from "@/generated/prisma/client";
import { fromMakeMeAHanzi } from "./reference";
import type { ReferenceCharacter } from "./types";

/** Raw Make Me a Hanzi data as Hanzi Writer expects it. */
export interface CharacterStrokeJson {
  strokes: string[];
  medians: number[][][];
}

const TTL_MS = 10 * 60 * 1000;
const levelCache = new Map<string, { at: number; refs: ReferenceCharacter[] }>();

/** Loads raw stroke data for the given characters from the database. */
export async function loadStrokeJson(prisma: PrismaClient, hanzi: readonly string[]) {
  const rows = await prisma.character.findMany({
    where: { hanzi: { in: [...hanzi] }, hasStrokeData: true },
    select: {
      hanzi: true,
      strokes: { orderBy: { strokeIndex: "asc" }, select: { path: true, median: true } },
    },
  });
  const result: Record<string, CharacterStrokeJson> = {};
  for (const row of rows) {
    result[row.hanzi] = {
      strokes: row.strokes.map((s) => s.path),
      medians: row.strokes.map((s) => s.median as number[][]),
    };
  }
  return result;
}

/**
 * Candidate set for identity verification: every character taught anywhere in the given HSK level.
 * Cached per level. Identity is verified relative to this set only.
 */
export async function loadLevelReferences(
  prisma: PrismaClient,
  levelId: string,
): Promise<ReferenceCharacter[]> {
  const cached = levelCache.get(levelId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.refs;
  const rows = await prisma.character.findMany({
    where: { hasStrokeData: true, lessons: { some: { lesson: { unit: { levelId } } } } },
    select: { hanzi: true, strokes: { orderBy: { strokeIndex: "asc" }, select: { median: true } } },
  });
  const refs = rows.map((r) =>
    fromMakeMeAHanzi(
      r.hanzi,
      r.strokes.map((s) => s.median as number[][]),
    ),
  );
  levelCache.set(levelId, { at: Date.now(), refs });
  return refs;
}
