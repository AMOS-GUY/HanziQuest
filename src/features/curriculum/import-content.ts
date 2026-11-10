import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { buildEvaluationConfig } from "@/features/exercises/evaluation-config";
import type { CurriculumContent, ContentWord } from "./content-schema";
import type { StrokeData } from "./stroke-data";

export interface ImportOptions {
  /** Publish lessons that are new in this import. Existing lessons keep their publication status. */
  publishNewLessons: boolean;
  lookupStrokes: (hanzi: string) => StrokeData | null;
}

export interface ImportSummary {
  curriculumId: string;
  charactersUpserted: number;
  strokeDataImported: number;
  vocabularyUpserted: number;
  lessonsCreated: number;
  lessonsUpdated: number;
  exercisesUpserted: number;
}

type Tx = Prisma.TransactionClient;

/**
 * Imports validated curriculum content. Idempotent and non-destructive:
 *  - records are upserted on stable keys (slugs, hanzi, simplified+pinyin, exercise keys);
 *  - nothing is deleted; words removed from a lesson are detached from that lesson only;
 *  - a lesson's contentVersion is bumped whenever its word list changes, so offline
 *    packages can detect stale downloads.
 * Always run validateCurriculumContent first.
 */
export async function importCurriculumContent(
  prisma: PrismaClient,
  content: CurriculumContent,
  options: ImportOptions,
): Promise<ImportSummary> {
  return prisma.$transaction(async (tx) => doImport(tx, content, options), {
    timeout: 120_000,
    maxWait: 10_000,
  });
}

async function doImport(
  tx: Tx,
  content: CurriculumContent,
  options: ImportOptions,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    curriculumId: "",
    charactersUpserted: 0,
    strokeDataImported: 0,
    vocabularyUpserted: 0,
    lessonsCreated: 0,
    lessonsUpdated: 0,
    exercisesUpserted: 0,
  };
  const c = content.curriculum;

  const curriculum = await tx.curriculum.upsert({
    where: { slug: c.slug },
    create: {
      slug: c.slug,
      name: c.name,
      framework: c.framework,
      version: c.version,
      description: c.description,
      source: c.source,
      licenseStatus: c.licenseStatus,
      verification: c.verification,
      status: options.publishNewLessons ? "PUBLISHED" : "DRAFT",
      publishedAt: options.publishNewLessons ? new Date() : null,
    },
    update: {
      name: c.name,
      description: c.description,
      source: c.source,
      licenseStatus: c.licenseStatus,
      verification: c.verification,
    },
  });
  summary.curriculumId = curriculum.id;

  const level = await tx.hSKLevel.upsert({
    where: { curriculumId_level: { curriculumId: curriculum.id, level: content.level.level } },
    create: {
      curriculumId: curriculum.id,
      level: content.level.level,
      name: content.level.name,
      description: content.level.description,
    },
    update: { name: content.level.name, description: content.level.description },
  });

  // Characters + reference strokes.
  const characterIds = new Map<string, string>();
  const strokeAvailable = new Set<string>();
  for (const [hanzi, def] of Object.entries(content.characters)) {
    const strokes = options.lookupStrokes(hanzi);
    const record = await tx.character.upsert({
      where: { hanzi },
      create: {
        hanzi,
        traditional: def.traditional,
        pinyin: def.pinyin,
        pinyinAlternatives: def.alternatives ?? [],
        meaning: def.meaning,
        radical: def.radical,
        strokeCount: strokes?.strokes.length ?? null,
        hasStrokeData: strokes !== null,
        source: c.source,
        licenseStatus: c.licenseStatus,
        verification: c.verification,
      },
      update: {
        pinyin: def.pinyin,
        pinyinAlternatives: def.alternatives ?? [],
        meaning: def.meaning,
        strokeCount: strokes?.strokes.length ?? null,
        hasStrokeData: strokes !== null,
      },
    });
    characterIds.set(hanzi, record.id);
    summary.charactersUpserted += 1;

    if (strokes) {
      strokeAvailable.add(hanzi);
      const existing = await tx.characterStroke.count({ where: { characterId: record.id } });
      if (existing !== strokes.strokes.length) {
        await tx.characterStroke.deleteMany({ where: { characterId: record.id } });
        await tx.characterStroke.createMany({
          data: strokes.strokes.map((path, strokeIndex) => ({
            characterId: record.id,
            strokeIndex,
            path,
            median: strokes.medians[strokeIndex] as unknown as Prisma.InputJsonValue,
          })),
        });
        summary.strokeDataImported += 1;
      }
      const assetExists = await tx.characterAsset.findFirst({
        where: { characterId: record.id, type: "STROKE_DATA" },
      });
      if (!assetExists) {
        await tx.characterAsset.create({
          data: {
            characterId: record.id,
            type: "STROKE_DATA",
            url: `hanzi-writer-data/${hanzi}.json`,
            source: "hanzi-writer-data 2.0.1 (Make Me a Hanzi)",
            licenseStatus: "OPEN_LICENSE",
          },
        });
      }
    }
  }

  const introduced = new Set<string>();
  let unitPosition = 0;
  for (const unit of content.units) {
    unitPosition += 1;
    const unitRecord = await tx.unit.upsert({
      where: { levelId_slug: { levelId: level.id, slug: unit.slug } },
      create: {
        levelId: level.id,
        slug: unit.slug,
        title: unit.title,
        description: unit.description,
        position: unitPosition,
      },
      update: { title: unit.title, description: unit.description, position: unitPosition },
    });

    let lessonPosition = 0;
    for (const lesson of unit.lessons) {
      lessonPosition += 1;
      const existing = await tx.lesson.findUnique({
        where: { unitId_slug: { unitId: unitRecord.id, slug: lesson.slug } },
        include: { vocabulary: { orderBy: { position: "asc" } } },
      });

      const vocabularyIds: string[] = [];
      for (const word of lesson.words) {
        vocabularyIds.push(
          await upsertWord(tx, word, characterIds, c.source, c.licenseStatus, c.verification),
        );
        summary.vocabularyUpserted += 1;
      }

      const wordListChanged =
        !existing ||
        existing.vocabulary.length !== vocabularyIds.length ||
        existing.vocabulary.some((v, i) => v.vocabularyId !== vocabularyIds[i]);

      const lessonRecord = existing
        ? await tx.lesson.update({
            where: { id: existing.id },
            data: {
              title: lesson.title,
              description: lesson.description,
              position: lessonPosition,
              contentVersion: wordListChanged
                ? existing.contentVersion + 1
                : existing.contentVersion,
            },
          })
        : await tx.lesson.create({
            data: {
              unitId: unitRecord.id,
              slug: lesson.slug,
              title: lesson.title,
              description: lesson.description,
              position: lessonPosition,
              status: options.publishNewLessons ? "PUBLISHED" : "DRAFT",
              publishedAt: options.publishNewLessons ? new Date() : null,
            },
          });
      if (existing) summary.lessonsUpdated += 1;
      else summary.lessonsCreated += 1;

      if (wordListChanged) {
        await tx.lessonVocabulary.deleteMany({ where: { lessonId: lessonRecord.id } });
        await tx.lessonVocabulary.createMany({
          data: vocabularyIds.map((vocabularyId, i) => ({
            lessonId: lessonRecord.id,
            vocabularyId,
            position: i + 1,
          })),
        });
      }

      const built = await buildLessonContent(tx, {
        curriculumId: curriculum.id,
        lessonId: lessonRecord.id,
        words: lesson.words.map((w, i) => ({ ...w, vocabularyId: vocabularyIds[i]! })),
        introducedBefore: introduced,
        characters: new Map(
          [...characterIds].map(([hanzi, id]) => [
            hanzi,
            {
              id,
              pinyin: content.characters[hanzi]!.pinyin,
              meaning: content.characters[hanzi]!.meaning,
              hasStrokes: strokeAvailable.has(hanzi),
            },
          ]),
        ),
      });
      for (const hanzi of built.characters) introduced.add(hanzi);
      summary.exercisesUpserted += built.generatedExercises;
    }
  }

  return summary;
}

export interface LessonWordInput {
  vocabularyId: string;
  simplified: string;
  pinyin: string;
  meaning: string;
}

export interface LessonCharacterInfo {
  id: string;
  pinyin: string;
  meaning: string;
  hasStrokes: boolean;
}

/** Prefix of exercises written by hand in the admin; they survive lesson rebuilds. */
export const CUSTOM_EXERCISE_PREFIX = "custom:";

/**
 * Rebuilds a lesson's characters and generated exercises from its ordered word list.
 * Used by both the importer and the admin editor so generation rules live in one place:
 * guided stroke practice for characters new to the level, two recall exercises per writable
 * word, then free writing of the new characters. Hand-written (custom) exercises stay attached
 * after the generated ones.
 */
export async function buildLessonContent(
  tx: Tx,
  input: {
    curriculumId: string;
    lessonId: string;
    words: LessonWordInput[];
    /** Characters introduced by earlier lessons in the level. */
    introducedBefore: ReadonlySet<string>;
    characters: ReadonlyMap<string, LessonCharacterInfo>;
  },
): Promise<{ characters: string[]; generatedExercises: number }> {
  const { curriculumId, lessonId, words, characters } = input;
  const lessonChars: { hanzi: string; isNew: boolean }[] = [];
  for (const word of words) {
    for (const ch of word.simplified) {
      if (lessonChars.some((lc) => lc.hanzi === ch)) continue;
      lessonChars.push({ hanzi: ch, isNew: !input.introducedBefore.has(ch) });
    }
  }
  const info = (hanzi: string) => {
    const c = characters.get(hanzi);
    if (!c) throw new Error(`Character ${hanzi} is not in the database`);
    return c;
  };
  await tx.lessonCharacter.deleteMany({ where: { lessonId } });
  await tx.lessonCharacter.createMany({
    data: lessonChars.map((lc, i) => ({
      lessonId,
      characterId: info(lc.hanzi).id,
      position: i + 1,
      isNew: lc.isNew,
    })),
  });

  const exerciseIds: string[] = [];
  const newChars = lessonChars.filter((lc) => lc.isNew && info(lc.hanzi).hasStrokes);
  for (const { hanzi } of newChars) {
    const c = info(hanzi);
    exerciseIds.push(
      await upsertExercise(tx, curriculumId, {
        key: `char:${hanzi}:guided-stroke`,
        type: "GUIDED_STROKE",
        prompt: { hanzi, pinyin: c.pinyin, meaning: c.meaning },
        expectedAnswer: hanzi,
        characterId: c.id,
        difficulty: 1,
        hint: null,
        evaluationConfig: buildEvaluationConfig("GUIDED", [hanzi]),
      }),
    );
  }
  for (const word of words) {
    const chars = [...word.simplified];
    if (!chars.every((ch) => info(ch).hasStrokes)) continue;
    const wordKey = `word:${word.simplified}:${word.pinyin}`;
    const singleCharId = chars.length === 1 ? info(chars[0]!).id : null;
    exerciseIds.push(
      await upsertExercise(tx, curriculumId, {
        key: `${wordKey}:meaning-to-hanzi`,
        type: "MEANING_TO_HANZI",
        prompt: { meaning: word.meaning },
        expectedAnswer: word.simplified,
        vocabularyId: word.vocabularyId,
        characterId: singleCharId,
        difficulty: Math.min(5, chars.length + 1),
        hint: word.pinyin,
        evaluationConfig: buildEvaluationConfig("INDEPENDENT", chars),
      }),
    );
    exerciseIds.push(
      await upsertExercise(tx, curriculumId, {
        key: `${wordKey}:pinyin-to-hanzi`,
        type: "PINYIN_TO_HANZI",
        prompt: { pinyin: word.pinyin },
        expectedAnswer: word.simplified,
        vocabularyId: word.vocabularyId,
        characterId: singleCharId,
        difficulty: Math.min(5, chars.length + 1),
        hint: word.meaning,
        evaluationConfig: buildEvaluationConfig("INDEPENDENT", chars),
      }),
    );
  }
  for (const { hanzi } of newChars) {
    const c = info(hanzi);
    exerciseIds.push(
      await upsertExercise(tx, curriculumId, {
        key: `char:${hanzi}:freehand`,
        type: "FREEHAND_WRITING",
        prompt: { pinyin: c.pinyin, meaning: c.meaning },
        expectedAnswer: hanzi,
        characterId: c.id,
        difficulty: 2,
        hint: null,
        evaluationConfig: buildEvaluationConfig("INDEPENDENT", [hanzi]),
      }),
    );
  }

  const custom = await tx.lessonExercise.findMany({
    where: { lessonId, exercise: { key: { startsWith: CUSTOM_EXERCISE_PREFIX } } },
    orderBy: { position: "asc" },
    select: { exerciseId: true },
  });
  const ordered = [...new Set([...exerciseIds, ...custom.map((c) => c.exerciseId)])];
  await tx.lessonExercise.deleteMany({ where: { lessonId } });
  await tx.lessonExercise.createMany({
    data: ordered.map((exerciseId, i) => ({ lessonId, exerciseId, position: i + 1 })),
  });
  return { characters: lessonChars.map((lc) => lc.hanzi), generatedExercises: exerciseIds.length };
}

async function upsertWord(
  tx: Tx,
  word: ContentWord,
  characterIds: Map<string, string>,
  defaultSource: string,
  licenseStatus: CurriculumContent["curriculum"]["licenseStatus"],
  verification: CurriculumContent["curriculum"]["verification"],
): Promise<string> {
  const record = await tx.vocabulary.upsert({
    where: { simplified_pinyin: { simplified: word.simplified, pinyin: word.pinyin } },
    create: {
      simplified: word.simplified,
      traditional: word.traditional,
      pinyin: word.pinyin,
      meaning: word.meaning,
      partOfSpeech: word.partOfSpeech,
      source: word.source ?? defaultSource,
      licenseStatus,
      verification,
    },
    update: {
      meaning: word.meaning,
      partOfSpeech: word.partOfSpeech,
      source: word.source ?? defaultSource,
    },
  });
  const chars = [...word.simplified];
  await tx.vocabularyCharacter.deleteMany({ where: { vocabularyId: record.id } });
  await tx.vocabularyCharacter.createMany({
    data: chars.map((ch, i) => ({
      vocabularyId: record.id,
      characterId: characterIds.get(ch)!,
      position: i + 1,
    })),
  });
  return record.id;
}

interface ExerciseInput {
  key: string;
  type: "PINYIN_TO_HANZI" | "MEANING_TO_HANZI" | "GUIDED_STROKE" | "FREEHAND_WRITING";
  prompt: Record<string, string>;
  expectedAnswer: string;
  characterId?: string | null;
  vocabularyId?: string | null;
  difficulty: number;
  hint: string | null;
  evaluationConfig: unknown;
}

async function upsertExercise(tx: Tx, curriculumId: string, input: ExerciseInput): Promise<string> {
  const data = {
    type: input.type,
    prompt: input.prompt as Prisma.InputJsonValue,
    expectedAnswer: input.expectedAnswer,
    characterId: input.characterId ?? null,
    vocabularyId: input.vocabularyId ?? null,
    difficulty: input.difficulty,
    hint: input.hint,
    evaluationConfig: input.evaluationConfig as Prisma.InputJsonValue,
  };
  const record = await tx.exercise.upsert({
    where: { curriculumId_key: { curriculumId, key: input.key } },
    create: { curriculumId, key: input.key, ...data },
    update: data,
  });
  return record.id;
}
