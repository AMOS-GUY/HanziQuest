/**
 * Pinyin analysis for content validation: splits a word's pinyin into syllables with tones and
 * checks each syllable against the readings defined for its character.
 *
 * Tones: 1–4 from the tone mark, 5 for neutral (no mark). "ü" is kept distinct from "u" (as "v").
 */

const TONE_MARKS: Record<string, number> = {
  "̄": 1, // macron  ā
  "́": 2, // acute   á
  "̌": 3, // caron   ǎ
  "̀": 4, // grave   à
};

export interface Syllable {
  /** Toneless syllable, lowercase, "v" for ü (e.g. "lv", "hao"). */
  base: string;
  /** 1–4, or 5 for neutral tone. */
  tone: number;
  /** As written. */
  text: string;
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

/** Letters of a chunk with the tone carried by each letter (0 = none). */
function decompose(chunk: string): { letters: string; tones: number[] } {
  let letters = "";
  const tones: number[] = [];
  for (const ch of chunk.normalize("NFD").toLowerCase()) {
    if (ch === "̈") {
      // ü: diaeresis follows the u.
      if (letters.endsWith("u")) letters = `${letters.slice(0, -1)}v`;
      continue;
    }
    const tone = TONE_MARKS[ch];
    if (tone !== undefined) {
      if (tones.length > 0) tones[tones.length - 1] = tone;
      continue;
    }
    if (/[̀-ͯ]/.test(ch)) continue;
    letters += ch === "ü" ? "v" : ch;
    tones.push(0);
  }
  return { letters, tones };
}

/** Segments one unspaced chunk into the fewest valid syllables, or null if impossible. */
function segment(letters: string): [number, number][] | null {
  const memo = new Map<number, [number, number][] | null>();
  const solve = (pos: number): [number, number][] | null => {
    if (pos === letters.length) return [];
    if (memo.has(pos)) return memo.get(pos)!;
    let best: [number, number][] | null = null;
    for (const initial of ["", ...INITIALS]) {
      if (!letters.startsWith(initial, pos)) continue;
      for (const final of FINALS) {
        if (final === "er" && initial !== "") continue;
        if (!letters.startsWith(final, pos + initial.length)) continue;
        const end = pos + initial.length + final.length;
        const rest = solve(end);
        if (rest && (!best || rest.length + 1 < best.length)) best = [[pos, end], ...rest];
      }
    }
    memo.set(pos, best);
    return best;
  };
  return solve(0);
}

/** Splits pinyin into syllables. Returns null when some part cannot be segmented. */
export function splitPinyin(pinyin: string): Syllable[] | null {
  const syllables: Syllable[] = [];
  for (const chunk of pinyin.replace(/['’-]/g, " ").split(/\s+/).filter(Boolean)) {
    const { letters, tones } = decompose(chunk);
    const parts = segment(letters);
    if (!parts) return null;
    for (const [start, end] of parts) {
      const tone = tones.slice(start, end).find((t) => t > 0) ?? 5;
      syllables.push({ base: letters.slice(start, end), tone, text: letters.slice(start, end) });
    }
  }
  return syllables;
}

export function syllableOf(reading: string): Syllable | null {
  const s = splitPinyin(reading);
  return s && s.length === 1 ? s[0]! : null;
}

export interface ReadingIssue {
  index: number;
  hanzi: string;
  written: string;
  kind: "unknown_reading" | "tone_mismatch";
  message: string;
}

/** Characters whose tone changes regularly in context (written with the changed tone in pinyin). */
const TONE_SANDHI_CHARACTERS = new Set(["一", "不"]);

/**
 * Checks each syllable of a word against its character's readings (main + alternatives).
 * - A syllable whose letters match no reading is an `unknown_reading` (likely a typo, or a
 *   missing polyphone reading).
 * - A different tone is a `tone_mismatch`, except: neutral tone (common in words such as
 *   谢谢 xièxie), and 一/不, whose sandhi is conventionally written.
 */
export function checkWordReadings(
  simplified: string,
  pinyin: string,
  readingsOf: (hanzi: string) => readonly string[] | undefined,
): ReadingIssue[] {
  const chars = [...simplified];
  const syllables = splitPinyin(pinyin);
  if (!syllables || syllables.length !== chars.length) return [];
  const issues: ReadingIssue[] = [];
  chars.forEach((hanzi, index) => {
    const readings = (readingsOf(hanzi) ?? [])
      .map(syllableOf)
      .filter((r): r is Syllable => r !== null);
    if (readings.length === 0) return;
    const written = syllables[index]!;
    const sameLetters = readings.filter((r) => r.base === written.base);
    if (sameLetters.length === 0) {
      issues.push({
        index,
        hanzi,
        written: written.text,
        kind: "unknown_reading",
        message: `"${written.text}" is not a reading of ${hanzi} (defined: ${(readingsOf(hanzi) ?? []).join(", ")})`,
      });
      return;
    }
    if (written.tone === 5 || TONE_SANDHI_CHARACTERS.has(hanzi)) return;
    if (!sameLetters.some((r) => r.tone === written.tone || r.tone === 5)) {
      issues.push({
        index,
        hanzi,
        written: written.text,
        kind: "tone_mismatch",
        message: `${hanzi} is written with tone ${written.tone} here, but its defined reading${sameLetters.length > 1 ? "s use" : " uses"} tone ${sameLetters.map((r) => r.tone).join("/")}`,
      });
    }
  });
  return issues;
}
