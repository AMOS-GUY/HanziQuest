/**
 * Content versions for review (M14-b, D-072).
 *
 * A review approves one exact version. The version is a canonical snapshot of everything a
 * reviewer judges (content and provenance), hashed: `"v1:" + sha256(canonical JSON)`. Any
 * change to those fields changes the fingerprint, so an earlier approval no longer applies.
 *
 * Not part of a version: verification status, review stamps, timestamps, publication status and
 * exercises (they don't change what was reviewed). Stroke data is included as a hash.
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export const FINGERPRINT_VERSION = "v1";

export interface ContentVersion {
  snapshot: Record<string, unknown>;
  fingerprint: string;
}

/** JSON with object keys sorted at every level, so equal content always serialises equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort())
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  return value === undefined ? null : value;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function versionOf(snapshot: Record<string, unknown>): ContentVersion {
  return { snapshot, fingerprint: `${FINGERPRINT_VERSION}:${sha256(canonicalJson(snapshot))}` };
}

const sorted = (xs: readonly string[]) => [...xs].sort();

/** Versions of characters, by id. */
export async function characterVersions(db: Db, ids: readonly string[]) {
  const rows = await db.character.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      hanzi: true,
      traditional: true,
      pinyin: true,
      pinyinAlternatives: true,
      meaning: true,
      radical: true,
      strokeCount: true,
      hasStrokeData: true,
      source: true,
      sourceRefs: true,
      licenseStatus: true,
      hsk20Level: true,
      hsk30Level: true,
      hsk30Handwriting: true,
      strokes: { orderBy: { strokeIndex: "asc" }, select: { median: true } },
    },
  });
  return new Map(
    rows.map(({ id, strokes, sourceRefs, ...c }) => [
      id,
      versionOf({
        kind: "CHARACTER",
        ...c,
        sourceRefs: sorted(sourceRefs),
        strokesSha256: sha256(canonicalJson(strokes.map((s) => s.median))),
      }),
    ]),
  );
}

/** Versions of words, by id. */
export async function vocabularyVersions(db: Db, ids: readonly string[]) {
  const rows = await db.vocabulary.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      simplified: true,
      traditional: true,
      pinyin: true,
      meaning: true,
      partOfSpeech: true,
      exampleZh: true,
      examplePinyin: true,
      exampleEn: true,
      exampleSourceRef: true,
      source: true,
      sourceRefs: true,
      licenseStatus: true,
      hsk20Level: true,
      hsk30Level: true,
      characters: {
        orderBy: { position: "asc" },
        select: { character: { select: { hanzi: true } } },
      },
    },
  });
  return new Map(
    rows.map(
      ({
        id,
        characters,
        sourceRefs,
        exampleZh,
        examplePinyin,
        exampleEn,
        exampleSourceRef,
        ...v
      }) => [
        id,
        versionOf({
          kind: "VOCABULARY",
          ...v,
          sourceRefs: sorted(sourceRefs),
          characters: characters.map((c) => c.character.hanzi),
          example: exampleZh
            ? { zh: exampleZh, pinyin: examplePinyin, en: exampleEn, sourceRef: exampleSourceRef }
            : null,
        }),
      ],
    ),
  );
}

export interface CurriculumItems {
  characterIds: string[];
  vocabularyIds: string[];
  /** Level, unit and lesson ids (structure the curriculum review covers). */
  structureIds: string[];
}

/** The characters and words a curriculum teaches (through its lessons), and its structure ids. */
export async function curriculumItems(db: Db, curriculumId: string): Promise<CurriculumItems> {
  const levels = await db.hSKLevel.findMany({
    where: { curriculumId },
    select: {
      id: true,
      units: {
        select: {
          id: true,
          lessons: {
            select: {
              id: true,
              characters: { select: { characterId: true } },
              vocabulary: { select: { vocabularyId: true } },
            },
          },
        },
      },
    },
  });
  const characterIds = new Set<string>();
  const vocabularyIds = new Set<string>();
  const structureIds: string[] = [];
  for (const l of levels) {
    structureIds.push(l.id);
    for (const u of l.units) {
      structureIds.push(u.id);
      for (const lesson of u.lessons) {
        structureIds.push(lesson.id);
        for (const c of lesson.characters) characterIds.add(c.characterId);
        for (const v of lesson.vocabulary) vocabularyIds.add(v.vocabularyId);
      }
    }
  }
  return {
    characterIds: sorted([...characterIds]),
    vocabularyIds: sorted([...vocabularyIds]),
    structureIds,
  };
}

/**
 * The curriculum's version: its metadata and sources, its structure (levels, units, lessons and
 * which words and characters each teaches, in order) and the fingerprint of every item. Any item
 * change therefore makes a curriculum approval stale too.
 */
export async function curriculumVersion(
  db: Db,
  curriculumId: string,
): Promise<ContentVersion | null> {
  const c = await db.curriculum.findUnique({
    where: { id: curriculumId },
    select: {
      slug: true,
      name: true,
      framework: true,
      version: true,
      description: true,
      source: true,
      sourceRefs: true,
      licenseStatus: true,
      levels: {
        orderBy: { level: "asc" },
        select: {
          level: true,
          name: true,
          description: true,
          units: {
            orderBy: { position: "asc" },
            select: {
              slug: true,
              title: true,
              description: true,
              lessons: {
                orderBy: { position: "asc" },
                select: {
                  slug: true,
                  title: true,
                  description: true,
                  characters: { orderBy: { position: "asc" }, select: { characterId: true } },
                  vocabulary: { orderBy: { position: "asc" }, select: { vocabularyId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!c) return null;
  const items = await curriculumItems(db, curriculumId);
  const [chars, words] = await Promise.all([
    characterVersions(db, items.characterIds),
    vocabularyVersions(db, items.vocabularyIds),
  ]);
  const { levels, sourceRefs, ...meta } = c;
  return versionOf({
    kind: "CURRICULUM",
    ...meta,
    sourceRefs: sorted(sourceRefs),
    levels: levels.map((l) => ({
      ...l,
      units: l.units.map((u) => ({
        ...u,
        lessons: u.lessons.map((lesson) => ({
          ...lesson,
          characters: lesson.characters.map((x) => chars.get(x.characterId)?.fingerprint ?? null),
          vocabulary: lesson.vocabulary.map((x) => words.get(x.vocabularyId)?.fingerprint ?? null),
        })),
      })),
    })),
  });
}
