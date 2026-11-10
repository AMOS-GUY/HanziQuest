import { curriculumContentSchema, type CurriculumContent } from "./content-schema";
import type { StrokeData } from "./stroke-data";

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
