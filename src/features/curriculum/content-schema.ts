import { z } from "zod";

/** Pinyin written with tone marks (or neutral-tone syllables), spaces and apostrophes. Tone numbers are rejected. */
const PINYIN_PATTERN = /^[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙ' ]+$/;
const HAN_PATTERN = /^\p{Script=Han}+$/u;

export const pinyinSchema = z
  .string()
  .trim()
  .min(1)
  .regex(PINYIN_PATTERN, "Pinyin must use tone marks (e.g. nǐ hǎo), not tone numbers");

export const hanziSchema = z
  .string()
  .trim()
  .min(1)
  .regex(HAN_PATTERN, "Must contain only Chinese characters");

export const contentCharacterSchema = z.object({
  pinyin: pinyinSchema,
  meaning: z.string().trim().min(1),
  alternatives: z.array(pinyinSchema).optional(),
  traditional: hanziSchema.optional(),
  radical: z.string().optional(),
});

export const contentWordSchema = z.object({
  simplified: hanziSchema,
  traditional: hanziSchema.optional(),
  pinyin: pinyinSchema,
  meaning: z.string().trim().min(1),
  partOfSpeech: z.string().optional(),
  source: z.string().optional(),
});

const slugSchema = z.string().regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and hyphens");

export const contentLessonSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  words: z.array(contentWordSchema).min(1),
});

export const contentUnitSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  lessons: z.array(contentLessonSchema).min(1),
});

export const curriculumContentSchema = z.object({
  curriculum: z.object({
    slug: slugSchema,
    name: z.string().min(1),
    framework: z.enum(["HSK_2_0", "HSK_3_0", "CUSTOM"]),
    version: z.string().min(1),
    description: z.string().optional(),
    source: z.string().min(1),
    licenseStatus: z.enum(["UNKNOWN", "OPEN_LICENSE", "LICENSED", "ORIGINAL", "PUBLIC_FACT"]),
    verification: z.enum(["PROVISIONAL", "REVIEWED", "VERIFIED"]),
  }),
  level: z.object({
    level: z.number().int().min(1).max(9),
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  characters: z.record(z.string(), contentCharacterSchema),
  units: z.array(contentUnitSchema).min(1),
});

export type CurriculumContent = z.infer<typeof curriculumContentSchema>;
export type ContentWord = z.infer<typeof contentWordSchema>;
