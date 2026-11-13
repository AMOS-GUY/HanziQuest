/**
 * Curriculum editing for administrators. Every change runs in one transaction that
 * (1) snapshots the previous record as a ContentRevision, (2) applies the change and
 * (3) writes an audit entry. Authorization is enforced by the calling action.
 *
 * Learner-facing changes bump `Lesson.contentVersion` so offline downloads detect them.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { hanziSchema, pinyinSchema } from "@/features/curriculum/content-schema";
import { loadStrokeData, type StrokeData } from "@/features/curriculum/stroke-data";
import {
  buildLessonContent,
  CUSTOM_EXERCISE_PREFIX,
  type LessonCharacterInfo,
} from "@/features/curriculum/import-content";
import { buildEvaluationConfig } from "@/features/exercises/evaluation-config";
import { DomainError, type Actor } from "./services";
import { lockForReview, reconcileReviews } from "@/features/curriculum/review";
import type { Verification } from "@/features/curriculum/provenance";

/** Source register id for content written in the admin (content/sources.json). */
const AUTHORED_SOURCE = "hanziquest-authored";

/**
 * Verification is never set through the edit forms (M14-b, D-071). New content starts
 * PROVISIONAL; an edit may resend the current value but never change it, whoever the actor is.
 * Only the review queue (`features/curriculum/review.ts`) raises it, for an exact fingerprinted
 * version, and only for holders of `curriculum:review` who didn't change that version.
 */
const VERIFICATION_VIA_QUEUE =
  "Verification can only be changed in the review queue (Admin → Review), by a content reviewer.";

function newContentVerification(requested: Verification | undefined) {
  if (requested !== undefined && requested !== "PROVISIONAL")
    throw new DomainError(
      "forbidden",
      `New content starts as Provisional. ${VERIFICATION_VIA_QUEUE}`,
    );
  return { verification: "PROVISIONAL" as const, reviewerRole: null, reviewedAt: null };
}

function withoutVerification<T extends { verification?: Verification }>(input: T) {
  const { verification: _unchanged, ...rest } = input;
  void _unchanged;
  return rest;
}

function unchangedVerification(before: Verification, requested: Verification | undefined) {
  if (requested !== undefined && requested !== before)
    throw new DomainError("forbidden", VERIFICATION_VIA_QUEUE);
  return {};
}

type Tx = Prisma.TransactionClient;

/** The curriculum a level, unit or lesson belongs to (for review reconciliation). */
async function curriculumOf(
  t: Tx,
  where: { levelId?: string; unitId?: string; lessonId?: string },
): Promise<string[]> {
  if (where.levelId) {
    const l = await t.hSKLevel.findUnique({
      where: { id: where.levelId },
      select: { curriculumId: true },
    });
    return l ? [l.curriculumId] : [];
  }
  if (where.unitId) {
    const u = await t.unit.findUnique({
      where: { id: where.unitId },
      select: { level: { select: { curriculumId: true } } },
    });
    return u ? [u.level.curriculumId] : [];
  }
  const l = await t.lesson.findUnique({
    where: { id: where.lessonId! },
    select: { unit: { select: { level: { select: { curriculumId: true } } } } },
  });
  return l ? [l.unit.level.curriculumId] : [];
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and hyphens");
const text = (max: number) => z.string().trim().min(1, "Required").max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));
const licenseStatus = z.enum(["UNKNOWN", "OPEN_LICENSE", "LICENSED", "ORIGINAL", "PUBLIC_FACT"]);
/** Accepted only so that an unchanged value can be resent; see `unchangedVerification`. */
const verification = z.enum(["PROVISIONAL", "REVIEWED", "VERIFIED"]).optional();

export const curriculumInput = z.object({
  slug,
  name: text(120),
  framework: z.enum(["HSK_2_0", "HSK_3_0", "CUSTOM"]),
  version: text(40),
  description: optionalText(1000),
  source: text(300),
  licenseStatus,
  verification,
});
export const curriculumUpdate = curriculumInput.omit({
  slug: true,
  framework: true,
  version: true,
});

export const levelInput = z.object({
  curriculumId: z.string().min(1).max(64),
  level: z.coerce.number().int().min(1).max(9),
  name: text(80),
  description: optionalText(1000),
});
export const levelUpdate = levelInput.pick({ name: true, description: true });

export const unitInput = z.object({
  levelId: z.string().min(1).max(64),
  slug,
  title: text(120),
  description: optionalText(1000),
});
export const unitUpdate = z.object({
  title: text(120),
  description: optionalText(1000),
  position: z.coerce.number().int().min(1).max(999),
});

export const lessonInput = z.object({
  unitId: z.string().min(1).max(64),
  slug,
  title: text(120),
  description: optionalText(1000),
});
export const lessonUpdate = unitUpdate;

const pinyinList = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) =>
    v
      ? v
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : [],
  )
  .pipe(z.array(pinyinSchema).max(8));

export const characterInput = z.object({
  hanzi: hanziSchema.refine((h) => [...h].length === 1, "Exactly one character"),
  pinyin: pinyinSchema,
  pinyinAlternatives: pinyinList,
  meaning: text(200),
  traditional: optionalText(4),
  radical: optionalText(4),
  source: text(300),
  licenseStatus,
  verification,
});
export const characterUpdate = characterInput.omit({ hanzi: true });

export const vocabularyInput = z.object({
  simplified: hanziSchema.refine((h) => [...h].length <= 6, "At most 6 characters"),
  pinyin: pinyinSchema,
  meaning: text(200),
  traditional: optionalText(12),
  partOfSpeech: optionalText(40),
  exampleZh: optionalText(200),
  examplePinyin: optionalText(300),
  exampleEn: optionalText(300),
  source: text(300),
  licenseStatus,
  verification,
});
export const vocabularyUpdate = vocabularyInput.omit({ simplified: true, pinyin: true });

/** One word per line: `你好 | nǐ hǎo`. Words must already exist in the vocabulary. */
export const lessonWordsInput = z.object({
  words: z
    .string()
    .max(5000)
    .transform((raw) =>
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1, "A lesson needs at least one word").max(40)),
});

export const exerciseUpdate = z.object({
  promptText: text(200),
  hint: optionalText(200),
  difficulty: z.coerce.number().int().min(1).max(5),
  status: z.enum(["PUBLISHED", "DRAFT", "ARCHIVED"]),
});

export const customExerciseInput = z.object({
  lessonId: z.string().min(1).max(64),
  type: z.enum(["MEANING_TO_HANZI", "PINYIN_TO_HANZI", "FREEHAND_WRITING"]),
  answer: hanziSchema.refine((h) => [...h].length <= 6, "At most 6 characters"),
  promptText: text(200),
  hint: optionalText(200),
  difficulty: z.coerce.number().int().min(1).max(5),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function revision(tx: Tx, actor: Actor, entityType: string, entityId: string, data: unknown) {
  const last = await tx.contentRevision.findFirst({
    where: { entityType, entityId },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  await tx.contentRevision.create({
    data: {
      entityType,
      entityId,
      revision: (last?.revision ?? 0) + 1,
      data: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
      authorId: actor.id,
    },
  });
}

function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
) {
  const json = (v: unknown) =>
    v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);
  return recordAudit(tx, {
    actorId: actor.id,
    action,
    entityType,
    entityId,
    before: json(before),
    after: json(after),
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  });
}

function unique(error: unknown, message: string): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  ) {
    throw new DomainError("conflict", message);
  }
  throw error;
}

function tx<T>(prisma: PrismaClient, fn: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(fn, { timeout: 30_000 });
}

async function bumpLessons(t: Tx, lessonIds: string[]) {
  if (lessonIds.length === 0) return;
  await t.lesson.updateMany({
    where: { id: { in: lessonIds } },
    data: { contentVersion: { increment: 1 } },
  });
}

// ─── Curricula and levels ───────────────────────────────────────────────────

export async function createCurriculum(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = curriculumInput.parse(raw);
  return tx(prisma, async (t) => {
    const created = await t.curriculum
      .create({
        data: {
          ...withoutVerification(input),
          // Curricula carry no reviewer stamp columns, only the status.
          verification: newContentVerification(input.verification).verification,
        },
      })
      .catch((e: unknown) =>
        unique(e, "A curriculum with this slug or framework version already exists."),
      );
    await audit(t, actor, "curriculum.create", "Curriculum", created.id, undefined, input);
    return created;
  });
}

export async function updateCurriculum(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  const input = curriculumUpdate.parse(raw);
  return tx(prisma, async (t) => {
    await lockForReview(t, { curriculumIds: [id] });
    const before = await t.curriculum.findUnique({ where: { id } });
    if (!before) throw new DomainError("not_found", "Curriculum not found.");
    unchangedVerification(before.verification, input.verification);
    await revision(t, actor, "Curriculum", id, before);
    const { verification: _unchanged, ...changes } = input;
    void _unchanged;
    const updated = await t.curriculum.update({ where: { id }, data: changes });
    await audit(t, actor, "curriculum.update", "Curriculum", id, before, input);
    await reconcileReviews(t, { curriculumIds: [id] }, actor.id);
    return updated;
  });
}

export async function createLevel(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = levelInput.parse(raw);
  return tx(prisma, async (t) => {
    const created = await t.hSKLevel
      .create({ data: input })
      .catch((e: unknown) => unique(e, "This level already exists in the curriculum."));
    await audit(t, actor, "level.create", "HSKLevel", created.id, undefined, input);
    await reconcileReviews(t, { curriculumIds: [created.curriculumId] }, actor.id);
    return created;
  });
}

export async function updateLevel(prisma: PrismaClient, actor: Actor, id: string, raw: unknown) {
  const input = levelUpdate.parse(raw);
  return tx(prisma, async (t) => {
    const before = await t.hSKLevel.findUnique({ where: { id } });
    if (!before) throw new DomainError("not_found", "Level not found.");
    await revision(t, actor, "HSKLevel", id, before);
    const updated = await t.hSKLevel.update({ where: { id }, data: input });
    await audit(t, actor, "level.update", "HSKLevel", id, before, input);
    await reconcileReviews(t, { curriculumIds: await curriculumOf(t, { levelId: id }) }, actor.id);
    return updated;
  });
}

// ─── Units and lessons ──────────────────────────────────────────────────────

export async function createUnit(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = unitInput.parse(raw);
  return tx(prisma, async (t) => {
    const level = await t.hSKLevel.findUnique({ where: { id: input.levelId } });
    if (!level) throw new DomainError("not_found", "Level not found.");
    const last = await t.unit.findFirst({
      where: { levelId: input.levelId },
      orderBy: { position: "desc" },
    });
    const created = await t.unit
      .create({ data: { ...input, position: (last?.position ?? 0) + 1 } })
      .catch((e: unknown) => unique(e, "A unit with this slug already exists in the level."));
    await audit(t, actor, "unit.create", "Unit", created.id, undefined, input);
    await reconcileReviews(
      t,
      { curriculumIds: await curriculumOf(t, { unitId: created.id }) },
      actor.id,
    );
    return created;
  });
}

export async function updateUnit(prisma: PrismaClient, actor: Actor, id: string, raw: unknown) {
  const input = unitUpdate.parse(raw);
  return tx(prisma, async (t) => {
    const before = await t.unit.findUnique({ where: { id } });
    if (!before) throw new DomainError("not_found", "Unit not found.");
    await revision(t, actor, "Unit", id, before);
    const updated = await t.unit.update({ where: { id }, data: input });
    await audit(t, actor, "unit.update", "Unit", id, before, input);
    await reconcileReviews(t, { curriculumIds: await curriculumOf(t, { unitId: id }) }, actor.id);
    return updated;
  });
}

export async function createLesson(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = lessonInput.parse(raw);
  return tx(prisma, async (t) => {
    const unit = await t.unit.findUnique({ where: { id: input.unitId } });
    if (!unit) throw new DomainError("not_found", "Unit not found.");
    const last = await t.lesson.findFirst({
      where: { unitId: input.unitId },
      orderBy: { position: "desc" },
    });
    // New lessons always start as drafts; publishing is a separate, audited step.
    const created = await t.lesson
      .create({ data: { ...input, position: (last?.position ?? 0) + 1, status: "DRAFT" } })
      .catch((e: unknown) => unique(e, "A lesson with this slug already exists in the unit."));
    await audit(t, actor, "lesson.create", "Lesson", created.id, undefined, input);
    await reconcileReviews(
      t,
      { curriculumIds: await curriculumOf(t, { lessonId: created.id }) },
      actor.id,
    );
    return created;
  });
}

export async function updateLesson(prisma: PrismaClient, actor: Actor, id: string, raw: unknown) {
  const input = lessonUpdate.parse(raw);
  return tx(prisma, async (t) => {
    const before = await t.lesson.findUnique({ where: { id } });
    if (!before) throw new DomainError("not_found", "Lesson not found.");
    await revision(t, actor, "Lesson", id, before);
    const textChanged = before.title !== input.title || before.description !== input.description;
    const updated = await t.lesson.update({
      where: { id },
      data: {
        ...input,
        contentVersion: textChanged ? before.contentVersion + 1 : before.contentVersion,
      },
    });
    await audit(t, actor, "lesson.update", "Lesson", id, before, input);
    await reconcileReviews(t, { curriculumIds: await curriculumOf(t, { lessonId: id }) }, actor.id);
    return updated;
  });
}

async function characterInfo(t: Tx, hanzi: string[]) {
  const rows = await t.character.findMany({
    where: { hanzi: { in: hanzi } },
    select: { id: true, hanzi: true, pinyin: true, meaning: true, hasStrokeData: true },
  });
  return new Map<string, LessonCharacterInfo>(
    rows.map((r) => [
      r.hanzi,
      { id: r.id, pinyin: r.pinyin, meaning: r.meaning, hasStrokes: r.hasStrokeData },
    ]),
  );
}

/** Characters introduced by lessons before this one in the same level. */
async function introducedBefore(t: Tx, lessonId: string) {
  const lesson = await t.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    select: { position: true, unit: { select: { levelId: true, position: true } } },
  });
  const earlier = await t.lessonCharacter.findMany({
    where: {
      lesson: {
        unit: { levelId: lesson.unit.levelId },
        OR: [
          { unit: { position: { lt: lesson.unit.position } } },
          { unit: { position: lesson.unit.position }, position: { lt: lesson.position } },
        ],
      },
    },
    select: { character: { select: { hanzi: true } } },
  });
  return new Set(earlier.map((e) => e.character.hanzi));
}

/**
 * Replaces a lesson's ordered word list and regenerates its characters and exercises.
 * Each line is "simplified | pinyin" (or just "simplified" when it is unambiguous).
 */
export async function setLessonWords(
  prisma: PrismaClient,
  actor: Actor,
  lessonId: string,
  raw: unknown,
) {
  const { words: lines } = lessonWordsInput.parse(raw);
  return tx(prisma, async (t) => {
    const lesson = await t.lesson.findUnique({
      where: { id: lessonId },
      include: {
        unit: { select: { level: { select: { curriculumId: true } } } },
        vocabulary: { orderBy: { position: "asc" }, include: { vocabulary: true } },
      },
    });
    if (!lesson) throw new DomainError("not_found", "Lesson not found.");

    const words = [];
    const problems: string[] = [];
    for (const line of lines) {
      const [simplified, pinyin] = line.split("|").map((p) => p.trim());
      const matches = await t.vocabulary.findMany({
        where: { simplified, ...(pinyin ? { pinyin } : {}) },
      });
      if (matches.length === 1) words.push(matches[0]!);
      else if (matches.length === 0) problems.push(`“${line}” is not in the vocabulary`);
      else problems.push(`“${line}” is ambiguous; add “| pinyin”`);
    }
    if (problems.length) throw new DomainError("conflict", problems.join(". ") + ".");
    if (new Set(words.map((w) => w.id)).size !== words.length)
      throw new DomainError("conflict", "A word is listed twice.");

    const before = lesson.vocabulary.map(
      (v) => `${v.vocabulary.simplified} | ${v.vocabulary.pinyin}`,
    );
    await revision(t, actor, "LessonWords", lessonId, { words: before });

    await t.lessonVocabulary.deleteMany({ where: { lessonId } });
    await t.lessonVocabulary.createMany({
      data: words.map((w, i) => ({ lessonId, vocabularyId: w.id, position: i + 1 })),
    });
    const chars = [...new Set(words.flatMap((w) => [...w.simplified]))];
    const built = await buildLessonContent(t, {
      curriculumId: lesson.unit.level.curriculumId,
      lessonId,
      words: words.map((w) => ({
        vocabularyId: w.id,
        simplified: w.simplified,
        pinyin: w.pinyin,
        meaning: w.meaning,
      })),
      introducedBefore: await introducedBefore(t, lessonId),
      characters: await characterInfo(t, chars),
    });
    await bumpLessons(t, [lessonId]);
    const after = words.map((w) => `${w.simplified} | ${w.pinyin}`);
    await audit(
      t,
      actor,
      "lesson.words.update",
      "Lesson",
      lessonId,
      { words: before },
      {
        words: after,
      },
    );
    await reconcileReviews(t, { curriculumIds: await curriculumOf(t, { lessonId }) }, actor.id);
    return built;
  });
}

// ─── Characters and vocabulary ──────────────────────────────────────────────

async function writeStrokes(t: Tx, characterId: string, hanzi: string, strokes: StrokeData) {
  await t.characterStroke.deleteMany({ where: { characterId } });
  await t.characterStroke.createMany({
    data: strokes.strokes.map((path, strokeIndex) => ({
      characterId,
      strokeIndex,
      path,
      median: strokes.medians[strokeIndex] as unknown as Prisma.InputJsonValue,
    })),
  });
  const asset = await t.characterAsset.findFirst({ where: { characterId, type: "STROKE_DATA" } });
  if (!asset) {
    await t.characterAsset.create({
      data: {
        characterId,
        type: "STROKE_DATA",
        url: `hanzi-writer-data/${hanzi}.json`,
        source: "hanzi-writer-data 2.0.1 (Make Me a Hanzi)",
        licenseStatus: "OPEN_LICENSE",
      },
    });
  }
}

/** Creates a character; reference strokes come from the bundled open stroke dataset. */
export async function createCharacter(
  prisma: PrismaClient,
  actor: Actor,
  raw: unknown,
  lookup: (hanzi: string) => StrokeData | null = loadStrokeData,
) {
  const input = characterInput.parse(raw);
  const strokes = lookup(input.hanzi);
  return tx(prisma, async (t) => {
    const created = await t.character
      .create({
        data: {
          ...input,
          ...newContentVerification(input.verification),
          strokeCount: strokes?.strokes.length ?? null,
          hasStrokeData: strokes !== null,
        },
      })
      .catch((e: unknown) => unique(e, "This character already exists."));
    if (strokes) await writeStrokes(t, created.id, created.hanzi, strokes);
    await audit(t, actor, "character.create", "Character", created.id, undefined, {
      ...input,
      hasStrokeData: strokes !== null,
    });
    return created;
  });
}

export async function updateCharacter(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  const input = characterUpdate.parse(raw);
  return tx(prisma, async (t) => {
    await lockForReview(t, { characterIds: [id] });
    const before = await t.character.findUnique({ where: { id } });
    if (!before) throw new DomainError("not_found", "Character not found.");
    await revision(t, actor, "Character", id, before);
    const updated = await t.character.update({
      where: { id },
      data: {
        ...withoutVerification(input),
        ...unchangedVerification(before.verification, input.verification),
      },
    });
    // Guided and free-writing prompts show the character's pinyin and meaning.
    if (before.pinyin !== input.pinyin || before.meaning !== input.meaning) {
      const exercises = await t.exercise.findMany({
        where: { characterId: id, type: { in: ["GUIDED_STROKE", "FREEHAND_WRITING"] } },
        select: { id: true, type: true, key: true },
      });
      for (const e of exercises) {
        if (e.key.startsWith(CUSTOM_EXERCISE_PREFIX)) continue;
        await t.exercise.update({
          where: { id: e.id },
          data: {
            prompt:
              e.type === "GUIDED_STROKE"
                ? { hanzi: before.hanzi, pinyin: input.pinyin, meaning: input.meaning }
                : { pinyin: input.pinyin, meaning: input.meaning },
          },
        });
      }
      const lessons = await t.lessonCharacter.findMany({
        where: { characterId: id },
        select: { lessonId: true },
      });
      await bumpLessons(
        t,
        lessons.map((l) => l.lessonId),
      );
    }
    await audit(t, actor, "character.update", "Character", id, before, input);
    // An approval covers one exact version: a changed character returns to PROVISIONAL.
    await reconcileReviews(t, { characterIds: [id] }, actor.id);
    return updated;
  });
}

export async function createVocabulary(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = vocabularyInput.parse(raw);
  const chars = [...input.simplified];
  return tx(prisma, async (t) => {
    const known = await t.character.findMany({
      where: { hanzi: { in: chars } },
      select: { id: true, hanzi: true },
    });
    const ids = new Map(known.map((k) => [k.hanzi, k.id]));
    const missing = [...new Set(chars.filter((c) => !ids.has(c)))];
    if (missing.length)
      throw new DomainError("conflict", `Add these characters first: ${missing.join(" ")}`);
    const created = await t.vocabulary
      .create({
        data: {
          ...input,
          ...newContentVerification(input.verification),
          ...(input.exampleZh && {
            exampleSourceRef: AUTHORED_SOURCE,
            exampleVerification: "PROVISIONAL" as const,
          }),
        },
      })
      .catch((e: unknown) => unique(e, "This word (with this pinyin) already exists."));
    await t.vocabularyCharacter.createMany({
      data: chars.map((c, i) => ({
        vocabularyId: created.id,
        characterId: ids.get(c)!,
        position: i + 1,
      })),
    });
    await audit(t, actor, "vocabulary.create", "Vocabulary", created.id, undefined, input);
    return created;
  });
}

export async function updateVocabulary(
  prisma: PrismaClient,
  actor: Actor,
  id: string,
  raw: unknown,
) {
  const input = vocabularyUpdate.parse(raw);
  return tx(prisma, async (t) => {
    await lockForReview(t, { vocabularyIds: [id] });
    const before = await t.vocabulary.findUnique({ where: { id } });
    if (!before) throw new DomainError("not_found", "Word not found.");
    await revision(t, actor, "Vocabulary", id, before);
    // An example edited here is team-authored and provisional until reviewed again (M14).
    const exampleChanged =
      before.exampleZh !== input.exampleZh ||
      before.examplePinyin !== input.examplePinyin ||
      before.exampleEn !== input.exampleEn;
    const updated = await t.vocabulary.update({
      where: { id },
      data: {
        ...withoutVerification(input),
        ...unchangedVerification(before.verification, input.verification),
        ...(exampleChanged && {
          exampleSourceRef: input.exampleZh ? AUTHORED_SOURCE : null,
          exampleVerification: input.exampleZh ? ("PROVISIONAL" as const) : null,
        }),
      },
    });
    if (before.meaning !== input.meaning) {
      // Keep generated prompts in step with the gloss.
      const key = `word:${before.simplified}:${before.pinyin}`;
      await t.exercise.updateMany({
        where: { vocabularyId: id, key: `${key}:meaning-to-hanzi` },
        data: { prompt: { meaning: input.meaning } },
      });
      await t.exercise.updateMany({
        where: { vocabularyId: id, key: `${key}:pinyin-to-hanzi` },
        data: { hint: input.meaning },
      });
    }
    const lessons = await t.lessonVocabulary.findMany({
      where: { vocabularyId: id },
      select: { lessonId: true },
    });
    await bumpLessons(
      t,
      lessons.map((l) => l.lessonId),
    );
    await audit(t, actor, "vocabulary.update", "Vocabulary", id, before, input);
    await reconcileReviews(t, { vocabularyIds: [id] }, actor.id);
    return updated;
  });
}

// ─── Exercises ──────────────────────────────────────────────────────────────

const PROMPT_FIELD = {
  PINYIN_TO_HANZI: "pinyin",
  MEANING_TO_HANZI: "meaning",
  FREEHAND_WRITING: "meaning",
  GUIDED_STROKE: "meaning",
  CHARACTER_RECONSTRUCTION: "meaning",
  LISTENING_TO_WRITING: "meaning",
} as const;

export function promptFieldFor(type: keyof typeof PROMPT_FIELD) {
  return PROMPT_FIELD[type];
}

/** Edits an exercise's wording, hint, difficulty and status. The expected answer is fixed. */
export async function updateExercise(prisma: PrismaClient, actor: Actor, id: string, raw: unknown) {
  const input = exerciseUpdate.parse(raw);
  return tx(prisma, async (t) => {
    const before = await t.exercise.findUnique({
      where: { id },
      include: { lessons: { select: { lessonId: true } } },
    });
    if (!before) throw new DomainError("not_found", "Exercise not found.");
    const field = PROMPT_FIELD[before.type];
    if (field === "pinyin") pinyinSchema.parse(input.promptText);
    const { lessons, ...snapshot } = before;
    await revision(t, actor, "Exercise", id, snapshot);
    const prompt = { ...(before.prompt as Record<string, string>), [field]: input.promptText };
    const updated = await t.exercise.update({
      where: { id },
      data: {
        prompt,
        hint: input.hint,
        difficulty: input.difficulty,
        status: input.status,
      },
    });
    await bumpLessons(
      t,
      lessons.map((l) => l.lessonId),
    );
    await audit(t, actor, "exercise.update", "Exercise", id, snapshot, { ...input, prompt });
    return updated;
  });
}

/** Adds a hand-written exercise to a lesson. Every answer character needs stroke data. */
export async function createCustomExercise(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = customExerciseInput.parse(raw);
  const chars = [...input.answer];
  if (input.type === "FREEHAND_WRITING" && chars.length !== 1)
    throw new DomainError("conflict", "Free writing exercises have exactly one character.");
  if (input.type === "PINYIN_TO_HANZI") pinyinSchema.parse(input.promptText);
  return tx(prisma, async (t) => {
    const lesson = await t.lesson.findUnique({
      where: { id: input.lessonId },
      include: { unit: { select: { level: { select: { curriculumId: true } } } } },
    });
    if (!lesson) throw new DomainError("not_found", "Lesson not found.");
    const info = await characterInfo(t, chars);
    const unusable = chars.filter((c) => !info.get(c)?.hasStrokes);
    if (unusable.length)
      throw new DomainError(
        "conflict",
        `No stroke data for: ${[...new Set(unusable)].join(" ")}. Add the character first.`,
      );
    const field = PROMPT_FIELD[input.type];
    const exercise = await t.exercise.create({
      data: {
        curriculumId: lesson.unit.level.curriculumId,
        key: `${CUSTOM_EXERCISE_PREFIX}${randomUUID()}`,
        type: input.type,
        prompt:
          input.type === "FREEHAND_WRITING"
            ? { pinyin: info.get(chars[0]!)!.pinyin, meaning: input.promptText }
            : { [field]: input.promptText },
        expectedAnswer: input.answer,
        characterId: chars.length === 1 ? info.get(chars[0]!)!.id : null,
        difficulty: input.difficulty,
        hint: input.hint,
        evaluationConfig: buildEvaluationConfig("INDEPENDENT", chars) as Prisma.InputJsonValue,
      },
    });
    const last = await t.lessonExercise.findFirst({
      where: { lessonId: lesson.id },
      orderBy: { position: "desc" },
    });
    await t.lessonExercise.create({
      data: { lessonId: lesson.id, exerciseId: exercise.id, position: (last?.position ?? 0) + 1 },
    });
    await bumpLessons(t, [lesson.id]);
    await audit(t, actor, "exercise.create", "Exercise", exercise.id, undefined, input);
    return exercise;
  });
}

/** Detaches a hand-written exercise from a lesson. Generated exercises follow the word list. */
export async function removeCustomExercise(
  prisma: PrismaClient,
  actor: Actor,
  lessonId: string,
  exerciseId: string,
) {
  return tx(prisma, async (t) => {
    const link = await t.lessonExercise.findUnique({
      where: { lessonId_exerciseId: { lessonId, exerciseId } },
      include: { exercise: true },
    });
    if (!link) throw new DomainError("not_found", "Exercise not found in this lesson.");
    if (!link.exercise.key.startsWith(CUSTOM_EXERCISE_PREFIX))
      throw new DomainError(
        "conflict",
        "Generated exercises follow the lesson's words. Edit the word list instead, or set the exercise to Draft.",
      );
    await revision(t, actor, "LessonExercise", `${lessonId}:${exerciseId}`, link);
    await t.lessonExercise.delete({ where: { lessonId_exerciseId: { lessonId, exerciseId } } });
    await bumpLessons(t, [lessonId]);
    await audit(t, actor, "exercise.detach", "Lesson", lessonId, { exerciseId }, undefined);
  });
}
