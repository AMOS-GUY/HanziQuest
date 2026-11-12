import "server-only";
import { prisma } from "@/lib/database/prisma";
import { evaluationConfigSchema } from "@/features/exercises/evaluation-config";
import type { ExerciseDTO, PracticePayload } from "@/features/exercises/dto";
import { loadLevelReferences, loadStrokeJson } from "@/features/handwriting/reference-store";
import { isLearnerVisible, LEARNER_VISIBLE_LESSON } from "@/features/curriculum/visibility";
import { getLessonStatesForLevel, type LessonState } from "@/features/progression/lesson-states";

type ExerciseRow = {
  id: string;
  type: ExerciseDTO["type"];
  prompt: unknown;
  hint: string | null;
  evaluationConfig: unknown;
};

function toDTO(e: ExerciseRow): ExerciseDTO {
  const config = evaluationConfigSchema.parse(e.evaluationConfig);
  return {
    id: e.id,
    type: e.type,
    prompt: e.prompt as ExerciseDTO["prompt"],
    characters: config.characters,
    hint: e.hint,
  };
}

async function buildPayload(exercises: ExerciseRow[], levelId: string): Promise<PracticePayload> {
  const dtos = exercises.map(toDTO);
  const chars = [...new Set(dtos.flatMap((e) => e.characters))];
  const [strokeData, candidates] = await Promise.all([
    loadStrokeJson(prisma, chars),
    loadLevelReferences(prisma, levelId),
  ]);
  return { exercises: dtos, strokeData, candidates };
}

const exerciseSelect = {
  id: true,
  type: true,
  prompt: true,
  hint: true,
  evaluationConfig: true,
} as const;

export async function getLessonForLearner(
  userId: string,
  lessonId: string,
  options: { preview?: boolean } = {},
) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      position: true,
      contentVersion: true,
      unit: {
        select: {
          title: true,
          position: true,
          levelId: true,
          level: {
            select: { name: true, curriculum: { select: { verification: true, status: true } } },
          },
        },
      },
      vocabulary: {
        orderBy: { position: "asc" },
        select: {
          vocabulary: {
            select: {
              id: true,
              simplified: true,
              pinyin: true,
              meaning: true,
              partOfSpeech: true,
              audioUrl: true,
            },
          },
        },
      },
      characters: {
        orderBy: { position: "asc" },
        select: {
          isNew: true,
          character: { select: { hanzi: true, pinyin: true, meaning: true, strokeCount: true } },
        },
      },
      _count: { select: { exercises: { where: { exercise: { status: "PUBLISHED" } } } } },
    },
  });
  if (!lesson || (!isLearnerVisible(lesson) && !options.preview)) return null;
  const { lessons, states } = await getLessonStatesForLevel(prisma, userId, lesson.unit.levelId);
  const state: LessonState = states.get(lesson.id) ?? "LOCKED";
  const index = lessons.findIndex((l) => l.id === lesson.id);
  return { ...lesson, state, nextLessonId: lessons[index + 1]?.id ?? null };
}

/**
 * Practice payload for a lesson: its published exercises only. `preview` lets admins load a
 * draft lesson exactly as learners will see it once published.
 */
export async function getLessonPractice(
  lessonId: string,
  options: { preview?: boolean } = {},
): Promise<PracticePayload | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      status: true,
      unit: {
        select: { levelId: true, level: { select: { curriculum: { select: { status: true } } } } },
      },
      exercises: {
        where: { exercise: { status: "PUBLISHED" } },
        orderBy: { position: "asc" },
        select: { exercise: { select: exerciseSelect } },
      },
    },
  });
  if (!lesson || (!isLearnerVisible(lesson) && !options.preview)) return null;
  return buildPayload(
    lesson.exercises.map((e) => e.exercise),
    lesson.unit.levelId,
  );
}

/** Guided + freehand practice for one character, from the first published lesson that teaches it. */
export async function getCharacterPractice(hanzi: string): Promise<PracticePayload | null> {
  const exercises = await prisma.exercise.findMany({
    where: {
      character: { hanzi },
      type: { in: ["GUIDED_STROKE", "FREEHAND_WRITING"] },
      status: "PUBLISHED",
      lessons: { some: { lesson: LEARNER_VISIBLE_LESSON } },
    },
    orderBy: { type: "asc" },
    select: {
      ...exerciseSelect,
      lessons: {
        where: { lesson: LEARNER_VISIBLE_LESSON },
        take: 1,
        select: { lesson: { select: { unit: { select: { levelId: true } } } } },
      },
    },
  });
  const guided = exercises.find((e) => e.type === "GUIDED_STROKE");
  const freehand = exercises.find((e) => e.type === "FREEHAND_WRITING");
  const ordered = [guided, freehand].filter((e): e is NonNullable<typeof e> => Boolean(e));
  const levelId = ordered[0]?.lessons[0]?.lesson.unit.levelId;
  if (ordered.length === 0 || !levelId) return null;
  return buildPayload(ordered, levelId);
}

export async function getVocabularyForLearner(id: string) {
  return prisma.vocabulary.findUnique({
    where: { id },
    select: {
      id: true,
      simplified: true,
      traditional: true,
      pinyin: true,
      meaning: true,
      partOfSpeech: true,
      audioUrl: true,
      exampleZh: true,
      examplePinyin: true,
      exampleEn: true,
      verification: true,
      characters: {
        orderBy: { position: "asc" },
        select: {
          character: { select: { hanzi: true, pinyin: true, meaning: true, strokeCount: true } },
        },
      },
      lessons: {
        where: { lesson: LEARNER_VISIBLE_LESSON },
        take: 1,
        select: { lesson: { select: { id: true, title: true } } },
      },
    },
  });
}

export async function getCharacterForLearner(hanzi: string) {
  const character = await prisma.character.findUnique({
    where: { hanzi },
    select: {
      hanzi: true,
      pinyin: true,
      pinyinAlternatives: true,
      meaning: true,
      strokeCount: true,
      hasStrokeData: true,
      vocabulary: {
        where: { vocabulary: { lessons: { some: { lesson: LEARNER_VISIBLE_LESSON } } } },
        select: {
          vocabulary: { select: { id: true, simplified: true, pinyin: true, meaning: true } },
        },
      },
    },
  });
  if (!character) return null;
  const strokeData = character.hasStrokeData
    ? ((await loadStrokeJson(prisma, [hanzi]))[hanzi] ?? null)
    : null;
  return { ...character, vocabulary: uniqueByVocabulary(character.vocabulary), strokeData };
}

/**
 * One entry per word. A word that uses the character more than once (谢谢, 爸爸) has one
 * link row per position, so the join returns it several times (M13 audit). Keeps first order.
 */
export function uniqueByVocabulary<T extends { vocabulary: { id: string } }>(
  rows: readonly T[],
): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.vocabulary.id) && (seen.add(r.vocabulary.id), true));
}

/** Free-writing exercises for a review round, in the given order. */
export async function getReviewPractice(exerciseIds: string[]): Promise<PracticePayload | null> {
  const rows = await prisma.exercise.findMany({
    where: {
      id: { in: exerciseIds },
      status: "PUBLISHED",
      lessons: { some: { lesson: LEARNER_VISIBLE_LESSON } },
    },
    select: {
      ...exerciseSelect,
      lessons: {
        where: { lesson: LEARNER_VISIBLE_LESSON },
        take: 1,
        select: { lesson: { select: { unit: { select: { levelId: true } } } } },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = exerciseIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  if (ordered.length === 0) return null;
  const levelIds = [
    ...new Set(ordered.flatMap((e) => (e.lessons[0] ? [e.lessons[0].lesson.unit.levelId] : []))),
  ];
  const dtos = ordered.map(toDTO);
  const chars = [...new Set(dtos.flatMap((e) => e.characters))];
  const [strokeData, ...levels] = await Promise.all([
    loadStrokeJson(prisma, chars),
    ...levelIds.map((id) => loadLevelReferences(prisma, id)),
  ]);
  const candidates = [...new Map(levels.flat().map((c) => [c.hanzi, c])).values()];
  return { exercises: dtos, strokeData, candidates };
}
