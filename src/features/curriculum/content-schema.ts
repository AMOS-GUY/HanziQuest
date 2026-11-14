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

/** Ids in the source register (content/sources.json). Checked by `checkSources`. */
const sourceRefsSchema = z
  .array(z.string().regex(/^[a-z0-9][a-z0-9.-]{1,63}$/, "Not a source id"))
  .max(10)
  .optional();

/**
 * Content files may only declare PROVISIONAL (D-074). REVIEWED and VERIFIED are assigned only
 * through the review workflow, which binds them to an exact version and a named reviewer role.
 * Other values are rejected, never silently downgraded.
 */
export const CONTENT_STATUS_MESSAGE =
  "Content files may only declare PROVISIONAL. REVIEWED and VERIFIED are assigned through the review workflow (Admin → Review), never by a file.";
const verificationSchema = z
  .enum(["PROVISIONAL", "REVIEWED", "VERIFIED"])
  .refine((v) => v === "PROVISIONAL", CONTENT_STATUS_MESSAGE);

/** Every status a content file declares, with its path (for the importer's own check). */
export function declaredStatuses(content: {
  curriculum: { verification: string };
  units: readonly {
    lessons: readonly {
      words: readonly { example?: { verification: string } | undefined }[];
    }[];
  }[];
}) {
  const out: { path: string; verification: string }[] = [
    { path: "curriculum.verification", verification: content.curriculum.verification },
  ];
  content.units.forEach((u, ui) =>
    u.lessons.forEach((l, li) =>
      l.words.forEach((w, wi) => {
        if (w.example)
          out.push({
            path: `units.${ui}.lessons.${li}.words.${wi}.example.verification`,
            verification: w.example.verification,
          });
      }),
    ),
  );
  return out;
}

/**
 * Per-standard level tags (M14). Optional: an untagged item makes no membership claim.
 * A tag must cite an approved OFFICIAL_LIST source in the register.
 */
const editionsSchema = z
  .strictObject({
    sourceRef: z.string().min(1),
    hsk20Level: z.number().int().min(1).max(6).optional(),
    hsk30Level: z.number().int().min(1).max(9).optional(),
  })
  .refine(
    (e) => e.hsk20Level !== undefined || e.hsk30Level !== undefined,
    "Give at least one level",
  );

const characterEditionsSchema = z
  .strictObject({
    sourceRef: z.string().min(1),
    hsk20Level: z.number().int().min(1).max(6).optional(),
    hsk30Level: z.number().int().min(1).max(9).optional(),
    /** On the HSK 3.0 handwriting list. */
    hsk30Handwriting: z.boolean().optional(),
  })
  .refine(
    (e) =>
      e.hsk20Level !== undefined || e.hsk30Level !== undefined || e.hsk30Handwriting !== undefined,
    "Give at least one tag",
  );

/** One example sentence with its own provenance (M14). */
export const contentExampleSchema = z.strictObject({
  zh: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[\p{Script=Han}\p{P}\s]+$/u, "Chinese characters and punctuation only"),
  pinyin: z.string().trim().min(1).max(300),
  en: z.string().trim().min(1).max(300),
  sourceRef: z.string().min(1),
  verification: verificationSchema,
});

export const contentCharacterSchema = z.object({
  pinyin: pinyinSchema,
  meaning: z.string().trim().min(1),
  alternatives: z.array(pinyinSchema).optional(),
  traditional: hanziSchema.optional(),
  radical: z.string().optional(),
  sourceRefs: sourceRefsSchema,
  editions: characterEditionsSchema.optional(),
});

export const contentWordSchema = z.object({
  simplified: hanziSchema,
  traditional: hanziSchema.optional(),
  pinyin: pinyinSchema,
  meaning: z.string().trim().min(1),
  partOfSpeech: z.string().optional(),
  source: z.string().optional(),
  sourceRefs: sourceRefsSchema,
  editions: editionsSchema.optional(),
  example: contentExampleSchema.optional(),
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
    sourceRefs: sourceRefsSchema,
    licenseStatus: z.enum(["UNKNOWN", "OPEN_LICENSE", "LICENSED", "ORIGINAL", "PUBLIC_FACT"]),
    verification: verificationSchema,
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
