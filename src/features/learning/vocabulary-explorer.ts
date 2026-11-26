import type { PrismaClient } from "@/generated/prisma/client";
import { LEARNER_VISIBLE_LESSON } from "@/features/curriculum/visibility";
import { getLessonStatesForLevel, type LessonState } from "@/features/progression/lesson-states";
import { filterExplorerWords, type ExplorerFilter, type ExplorerWord } from "./vocabulary-search";

/** A lesson the learner has reached, as the explorer lists it. */
export interface ExplorerLesson {
  id: string;
  title: string;
  unitTitle: string;
  state: Exclude<LessonState, "LOCKED">;
}

export interface VocabularyExplorer {
  /** Reached lessons in curriculum order (the filter's options). */
  lessons: ExplorerLesson[];
  /** Words matching the filter, from reached lessons only, each listed once. */
  words: ExplorerWord[];
  /** Words in reached lessons before filtering. */
  totalReached: number;
  /** True when some published lessons are still locked (their words aren't listed). */
  moreToUnlock: boolean;
  filter: ExplorerFilter;
}

/**
 * The words a learner may browse: those in lessons they have reached under the existing
 * progression rules (any state but LOCKED, from `getLessonStatesForLevel`), in published
 * lessons of published curricula. Locked lessons' words are never returned, so search, the
 * lesson filter and direct query strings can't reach them. No progression rule is added or
 * changed here; this only reads the states the learning path already shows.
 */
export async function getVocabularyExplorer(
  prisma: PrismaClient,
  userId: string,
  filter: ExplorerFilter = {},
): Promise<VocabularyExplorer> {
  const levels = await prisma.hSKLevel.findMany({
    where: { curriculum: { status: "PUBLISHED" } },
    orderBy: [{ curriculum: { createdAt: "asc" } }, { level: "asc" }],
    select: { id: true },
  });

  const reachedIds: string[] = [];
  const states = new Map<string, ExplorerLesson["state"]>();
  let moreToUnlock = false;
  for (const level of levels) {
    const { lessons, states: levelStates } = await getLessonStatesForLevel(
      prisma,
      userId,
      level.id,
    );
    for (const lesson of lessons) {
      const state = levelStates.get(lesson.id);
      if (!state || state === "LOCKED") {
        moreToUnlock = true;
        continue;
      }
      reachedIds.push(lesson.id);
      states.set(lesson.id, state);
    }
  }
  if (reachedIds.length === 0)
    return { lessons: [], words: [], totalReached: 0, moreToUnlock, filter };

  const [lessonRows, entries] = await Promise.all([
    prisma.lesson.findMany({
      where: { id: { in: reachedIds }, ...LEARNER_VISIBLE_LESSON },
      select: { id: true, title: true, unit: { select: { title: true } } },
    }),
    // One query for every reached lesson's words (no per-lesson round trips).
    prisma.lessonVocabulary.findMany({
      where: { lessonId: { in: reachedIds }, lesson: LEARNER_VISIBLE_LESSON },
      orderBy: { position: "asc" },
      select: {
        lessonId: true,
        vocabulary: {
          select: {
            id: true,
            simplified: true,
            pinyin: true,
            meaning: true,
            partOfSpeech: true,
            audioUrl: true,
            hsk20Level: true,
            verification: true,
            characters: {
              orderBy: { position: "asc" },
              select: { character: { select: { hanzi: true } } },
            },
          },
        },
      },
    }),
  ]);

  // Curriculum order, re-checked against visibility (both queries filter on it).
  const byId = new Map(lessonRows.map((l) => [l.id, l]));
  const lessons: ExplorerLesson[] = reachedIds.flatMap((id) => {
    const l = byId.get(id);
    return l ? [{ id, title: l.title, unitTitle: l.unit.title, state: states.get(id)! }] : [];
  });
  const order = new Map(lessons.map((l, i) => [l.id, i]));

  const seen = new Set<string>();
  const words: ExplorerWord[] = [];
  for (const e of [...entries].sort(
    (a, b) => (order.get(a.lessonId) ?? 0) - (order.get(b.lessonId) ?? 0),
  )) {
    if (!order.has(e.lessonId) || seen.has(e.vocabulary.id)) continue;
    seen.add(e.vocabulary.id);
    const v = e.vocabulary;
    words.push({
      id: v.id,
      simplified: v.simplified,
      pinyin: v.pinyin,
      meaning: v.meaning,
      partOfSpeech: v.partOfSpeech,
      audioUrl: v.audioUrl,
      hsk20Level: v.hsk20Level,
      provisional: v.verification !== "VERIFIED",
      characters: v.characters.map((c) => c.character.hanzi),
      lessonId: e.lessonId,
    });
  }

  return {
    lessons,
    words: filterExplorerWords(words, filter),
    totalReached: words.length,
    moreToUnlock,
    filter,
  };
}
