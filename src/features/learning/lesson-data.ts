import "server-only";
import { prisma } from "@/lib/database/prisma";
import { evaluationConfigSchema } from "@/features/exercises/evaluation-config";
import type { ExerciseDTO, PracticePayload } from "@/features/exercises/dto";
import { loadLevelReferences, loadStrokeJson } from "@/features/handwriting/reference-store";
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

export async function getLessonForLearner(userId: string, lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      position: true,
      unit: {
        select: {
          title: true,
          position: true,
          levelId: true,
          level: { select: { name: true, curriculum: { select: { verification: true } } } },
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
      _count: { select: { exercises: true } },
    },
  });
  if (!lesson || lesson.status !== "PUBLISHED") return null;
  const { lessons, states } = await getLessonStatesForLevel(prisma, userId, lesson.unit.levelId);
  const state: LessonState = states.get(lesson.id) ?? "LOCKED";
  const index = lessons.findIndex((l) => l.id === lesson.id);
  return { ...lesson, state, nextLessonId: lessons[index + 1]?.id ?? null };
}

export async function getLessonPractice(lessonId: string): Promise<PracticePayload | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      status: true,
      unit: { select: { levelId: true } },
      exercises: { orderBy: { position: "asc" }, select: { exercise: { select: exerciseSelect } } },
    },
  });
  if (!lesson || lesson.status !== "PUBLISHED") return null;
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
      lessons: { some: { lesson: { status: "PUBLISHED" } } },
    },
    orderBy: { type: "asc" },
    select: {
      ...exerciseSelect,
      lessons: { take: 1, select: { lesson: { select: { unit: { select: { levelId: true } } } } } },
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
        where: { lesson: { status: "PUBLISHED" } },
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
        where: { vocabulary: { lessons: { some: { lesson: { status: "PUBLISHED" } } } } },
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
  return { ...character, strokeData };
}
