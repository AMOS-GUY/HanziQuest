import { curriculumContentSchema, type CurriculumContent } from "./content-schema";
import type { StrokeData } from "./stroke-data";
import { checkWordReadings } from "./readings";

/** Pedagogical limits; exceeding them is a warning, not an error. */
export const CONTENT_LIMITS = {
  newCharactersPerLesson: 8,
  wordsPerLesson: 12,
  meaningLength: 120,
} as const;

export interface ContentIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ContentValidationResult {
  ok: boolean;
  content: CurriculumContent | null;
  issues: ContentIssue[];
  stats: { units: number; lessons: number; words: number; characters: number };
}

/**
 * Counts pinyin syllables by counting vowel nuclei after stripping tone marks.
 * Used as a sanity check that a word's pinyin matches its character count.
 */
export function countPinyinSyllables(pinyin: string): number {
  const normalized = pinyin
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ü/g, "v")
    .replace(/'/g, " ");
  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .reduce((total, chunk) => total + countChunkSyllables(chunk), 0);
}

const INITIALS = [
  "zh",
  "ch",
  "sh",
  "b",
  "p",
  "m",
  "f",
  "d",
  "t",
  "n",
  "l",
  "g",
  "k",
  "h",
  "j",
  "q",
  "x",
  "r",
  "z",
  "c",
  "s",
  "y",
  "w",
];
const FINALS = [
  "iang",
  "iong",
  "uang",
  "ueng",
  "ang",
  "eng",
  "ing",
  "ong",
  "ian",
  "iao",
  "uai",
  "uan",
  "van",
  "ai",
  "ei",
  "ao",
  "ou",
  "an",
  "en",
  "in",
  "un",
  "vn",
  "ia",
  "ie",
  "iu",
  "ua",
  "uo",
  "ui",
  "ue",
  "ve",
  "er",
  "a",
  "o",
  "e",
  "i",
  "u",
  "v",
];

/** Greedy segmentation of unspaced pinyin (e.g. "duibuqi") into syllables. Returns 0 if it cannot segment. */
function countChunkSyllables(chunk: string): number {
  const memo = new Map<number, number>();
  const solve = (pos: number): number => {
    if (pos === chunk.length) return 0;
    const cached = memo.get(pos);
    if (cached !== undefined) return cached;
    let best = -1;
    const initials = ["", ...INITIALS];
    for (const initial of initials) {
      if (!chunk.startsWith(initial, pos)) continue;
      for (const final of FINALS) {
        const end = pos + initial.length + final.length;
        if (!chunk.startsWith(final, pos + initial.length)) continue;
        // "er" only stands alone (no initial).
        if (final === "er" && initial !== "") continue;
        const rest = solve(end);
        if (rest >= 0 && (best < 0 || rest + 1 < best)) best = rest + 1;
      }
    }
    memo.set(pos, best);
    return best;
  };
  const result = solve(0);
  return result < 0 ? 0 : result;
}

/**
 * Validates curriculum content before import. Pure: stroke-data lookup is injected
 * so it can be unit tested without the filesystem.
 */
export function validateCurriculumContent(
  input: unknown,
  lookupStrokes: (hanzi: string) => StrokeData | null,
): ContentValidationResult {
  const issues: ContentIssue[] = [];
  const parsed = curriculumContentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ severity: "error", path: issue.path.join("."), message: issue.message });
    }
    return {
      ok: false,
      content: null,
      issues,
      stats: { units: 0, lessons: 0, words: 0, characters: 0 },
    };
  }

  const content = parsed.data;
  const c = content.curriculum;
  if (c.verification !== "PROVISIONAL" && (c.licenseStatus === "UNKNOWN" || !c.source.trim())) {
    issues.push({
      severity: "error",
      path: "curriculum.verification",
      message: `Content can't be marked ${c.verification} while its licence or source is unknown`,
    });
  } else if (c.licenseStatus === "UNKNOWN") {
    issues.push({
      severity: "warning",
      path: "curriculum.licenseStatus",
      message: "Licence status is UNKNOWN: confirm you may use this content before publishing",
    });
  }
  const readingsOf = (hanzi: string) => {
    const def = content.characters[hanzi];
    return def ? [def.pinyin, ...(def.alternatives ?? [])] : undefined;
  };
  const introduced = new Set<string>();
  const unitSlugs = new Set<string>();
  const seenWords = new Map<string, string>();
  const usedCharacters = new Set<string>();
  let lessons = 0;
  let words = 0;

  for (const hanzi of Object.keys(content.characters)) {
    if ([...hanzi].length !== 1 || !/^\p{Script=Han}$/u.test(hanzi)) {
      issues.push({
        severity: "error",
        path: `characters.${hanzi}`,
        message: "Character key must be a single Chinese character",
      });
    }
  }

  content.units.forEach((unit, u) => {
    if (unitSlugs.has(unit.slug)) {
      issues.push({
        severity: "error",
        path: `units.${u}.slug`,
        message: `Duplicate unit slug "${unit.slug}"`,
      });
    }
    unitSlugs.add(unit.slug);
    const lessonSlugs = new Set<string>();

    unit.lessons.forEach((lesson, l) => {
      lessons += 1;
      const lessonPath = `units.${u}.lessons.${l}`;
      if (lessonSlugs.has(lesson.slug)) {
        issues.push({
          severity: "error",
          path: `${lessonPath}.slug`,
          message: `Duplicate lesson slug "${lesson.slug}"`,
        });
      }
      lessonSlugs.add(lesson.slug);
      if (lesson.words.length > CONTENT_LIMITS.wordsPerLesson) {
        issues.push({
          severity: "warning",
          path: lessonPath,
          message: `${lesson.words.length} words in one lesson (suggested at most ${CONTENT_LIMITS.wordsPerLesson})`,
        });
      }
      const newHere = new Set(
        lesson.words.flatMap((w) => [...w.simplified]).filter((ch) => !introduced.has(ch)),
      );
      for (const ch of newHere) introduced.add(ch);
      if (newHere.size > CONTENT_LIMITS.newCharactersPerLesson) {
        issues.push({
          severity: "warning",
          path: lessonPath,
          message: `${newHere.size} new characters in one lesson (suggested at most ${CONTENT_LIMITS.newCharactersPerLesson})`,
        });
      }

      lesson.words.forEach((word, w) => {
        words += 1;
        const wordPath = `${lessonPath}.words.${w}`;
        const key = `${word.simplified}|${word.pinyin}`;
        const previous = seenWords.get(key);
        if (previous) {
          issues.push({
            severity: "error",
            path: wordPath,
            message: `Word ${word.simplified} already appears at ${previous}`,
          });
        }
        seenWords.set(key, wordPath);

        const chars = [...word.simplified];
        const syllables = countPinyinSyllables(word.pinyin);
        if (syllables !== chars.length) {
          issues.push({
            severity: "error",
            path: `${wordPath}.pinyin`,
            message: `"${word.pinyin}" has ${syllables} syllable(s) but ${word.simplified} has ${chars.length} character(s)`,
          });
        }

        if (syllables === chars.length) {
          for (const r of checkWordReadings(word.simplified, word.pinyin, readingsOf)) {
            issues.push({ severity: "warning", path: `${wordPath}.pinyin`, message: r.message });
          }
        }
        if (word.traditional && [...word.traditional].length !== chars.length) {
          issues.push({
            severity: "error",
            path: `${wordPath}.traditional`,
            message: `Traditional form ${word.traditional} has a different number of characters`,
          });
        }
        if (word.meaning.length > CONTENT_LIMITS.meaningLength) {
          issues.push({
            severity: "warning",
            path: `${wordPath}.meaning`,
            message: `Meaning is ${word.meaning.length} characters long; keep glosses short`,
          });
        }

        for (const ch of chars) {
          usedCharacters.add(ch);
          if (!content.characters[ch]) {
            issues.push({
              severity: "error",
              path: wordPath,
              message: `Character ${ch} is not defined in "characters"`,
            });
          }
        }
      });
    });
  });

  const byGloss = new Map<string, string[]>();
  for (const [hanzi, def] of Object.entries(content.characters)) {
    const gloss = def.meaning.trim().toLowerCase();
    byGloss.set(gloss, [...(byGloss.get(gloss) ?? []), hanzi]);
    if (def.traditional && [...def.traditional].length !== 1) {
      issues.push({
        severity: "error",
        path: `characters.${hanzi}.traditional`,
        message: "Traditional form must be a single character",
      });
    }
    if ((def.alternatives ?? []).includes(def.pinyin)) {
      issues.push({
        severity: "warning",
        path: `characters.${hanzi}.alternatives`,
        message: "Alternative reading repeats the main reading",
      });
    }
    for (const reading of [def.pinyin, ...(def.alternatives ?? [])]) {
      if (countPinyinSyllables(reading) !== 1) {
        issues.push({
          severity: "error",
          path: `characters.${hanzi}`,
          message: `"${reading}" is not a single syllable`,
        });
      }
    }
  }
  for (const [gloss, chars] of byGloss) {
    if (chars.length > 1) {
      issues.push({
        severity: "warning",
        path: `characters.${chars.join(",")}`,
        message: `${chars.join(" and ")} share the meaning "${gloss}": check for a copy-paste error, or add a distinguishing note`,
      });
    }
  }

  for (const hanzi of Object.keys(content.characters)) {
    if (!usedCharacters.has(hanzi)) {
      issues.push({
        severity: "warning",
        path: `characters.${hanzi}`,
        message: "Character is defined but not used by any word",
      });
    }
    if (!lookupStrokes(hanzi)) {
      issues.push({
        severity: "warning",
        path: `characters.${hanzi}`,
        message: "No stroke data available; writing exercises will be skipped",
      });
    }
  }

  return {
    ok: !issues.some((i) => i.severity === "error"),
    content,
    issues,
    stats: {
      units: content.units.length,
      lessons,
      words,
      characters: Object.keys(content.characters).length,
    },
  };
}
