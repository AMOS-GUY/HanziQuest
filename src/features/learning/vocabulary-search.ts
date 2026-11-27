/**
 * Search and filter for the Vocabulary Explorer. Pure functions (no database), run on the
 * server over words the learner has already been entitled to (see vocabulary-explorer.ts).
 */

export interface ExplorerWord {
  id: string;
  simplified: string;
  pinyin: string;
  meaning: string;
  partOfSpeech: string | null;
  audioUrl: string | null;
  /** Set only from an approved HSK list source (M14); null means "not tagged". */
  hsk20Level: number | null;
  provisional: boolean;
  characters: string[];
  /** The lesson the word is listed under: the first reached lesson (curriculum order) teaching it. */
  lessonId: string;
  /** Every reached lesson that teaches the word, in curriculum order (starts with `lessonId`). */
  lessonIds: string[];
}

export interface ExplorerFilter {
  q?: string;
  lessonId?: string;
}

export const MAX_QUERY_LENGTH = 50;

/** Lower case, tone marks and ü folded, tone numbers and spaces removed: "Nǐ hǎo" → "nihao". */
export function foldPinyin(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ü|u:|v/g, "u")
    .replace(/[\s'’·\-1-5]/g, "");
}

/** Normalises raw query-string input: trimmed, bounded length, empty becomes undefined. */
export function parseExplorerFilter(raw: { q?: unknown; lesson?: unknown }): ExplorerFilter {
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, MAX_QUERY_LENGTH) : "";
  const lessonId = typeof raw.lesson === "string" ? raw.lesson.trim().slice(0, 64) : "";
  return { q: q || undefined, lessonId: lessonId || undefined };
}

/**
 * Matches a word when the query appears in its Hanzi, its pinyin (with or without tones or
 * spaces: "ni hao", "nihao", "ni3hao3" and "nǐ hǎo" all match 你好) or its meaning. The lesson
 * filter keeps every word that lesson teaches, listed under it, including words an earlier lesson
 * also teaches. It only narrows: an id that isn't among the words' lessons matches nothing.
 */
export function filterExplorerWords(
  words: readonly ExplorerWord[],
  filter: ExplorerFilter,
): ExplorerWord[] {
  const q = filter.q?.trim();
  const folded = q ? foldPinyin(q) : "";
  const lower = q?.toLowerCase() ?? "";
  const { lessonId } = filter;
  return words
    .filter((w) => {
      if (lessonId && !w.lessonIds.includes(lessonId)) return false;
      if (!q) return true;
      return (
        w.simplified.includes(q) ||
        (folded.length > 0 && foldPinyin(w.pinyin).includes(folded)) ||
        w.meaning.toLowerCase().includes(lower)
      );
    })
    .map((w) => (lessonId && w.lessonId !== lessonId ? { ...w, lessonId } : w));
}
