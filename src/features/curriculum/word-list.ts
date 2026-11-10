/**
 * Coverage of a content file against an authoritative word list (for example the official HSK
 * vocabulary for a level), supplied by the owner from a source they are licensed to use.
 * HanziQuest does not ship such lists. See docs/M7_CURRICULUM_AND_LEARNING.md.
 *
 * List format: one entry per line. An entry is the simplified word, optionally followed by a tab
 * or "|" and its pinyin. Blank lines and lines starting with "#" are ignored. Variant forms
 * written as "爸爸（爸）" or "爸爸/爸" are split into alternatives.
 */
import type { CurriculumContent } from "./content-schema";

export interface WordListEntry {
  forms: string[];
  pinyin: string | null;
  line: number;
}

export function parseWordList(text: string): WordListEntry[] {
  const entries: WordListEntry[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/^﻿/, "").trim();
    if (!line || line.startsWith("#")) return;
    const [wordPart, pinyinPart] = line.split(/\t|\|/).map((p) => p.trim());
    const forms = (wordPart ?? "")
      .replace(/[（(]/g, "/")
      .replace(/[）)]/g, "")
      .split(/[/／、]/)
      .map((f) => f.trim())
      .filter((f) => /^\p{Script=Han}+$/u.test(f));
    if (forms.length === 0) return;
    entries.push({ forms, pinyin: pinyinPart || null, line: i + 1 });
  });
  return entries;
}

export interface CoverageReport {
  listSize: number;
  contentWords: number;
  /** Content words found in the list. */
  covered: number;
  /** Content words not in the list: must not be presented as part of that list. */
  notInList: { simplified: string; lesson: string }[];
  /** List entries the content doesn't teach yet. */
  missing: WordListEntry[];
  /** Same word, different pinyin from the list's (only when the list gives pinyin). */
  pinyinDiffers: { simplified: string; content: string; list: string }[];
}

const normalisePinyin = (p: string) =>
  p
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s'’]/g, "");

export function compareWithWordList(
  content: CurriculumContent,
  list: readonly WordListEntry[],
): CoverageReport {
  const byForm = new Map<string, WordListEntry>();
  for (const entry of list) for (const form of entry.forms) byForm.set(form, entry);
  const taught = new Set<string>();
  const notInList: CoverageReport["notInList"] = [];
  const pinyinDiffers: CoverageReport["pinyinDiffers"] = [];
  let contentWords = 0;
  for (const unit of content.units) {
    for (const lesson of unit.lessons) {
      for (const word of lesson.words) {
        contentWords += 1;
        const entry = byForm.get(word.simplified);
        if (!entry) {
          notInList.push({ simplified: word.simplified, lesson: `${unit.slug}/${lesson.slug}` });
          continue;
        }
        taught.add(entry.forms[0]!);
        if (entry.pinyin && normalisePinyin(entry.pinyin) !== normalisePinyin(word.pinyin)) {
          pinyinDiffers.push({
            simplified: word.simplified,
            content: word.pinyin,
            list: entry.pinyin,
          });
        }
      }
    }
  }
  return {
    listSize: list.length,
    contentWords,
    covered: contentWords - notInList.length,
    notInList,
    missing: list.filter((e) => !taught.has(e.forms[0]!)),
    pinyinDiffers,
  };
}
