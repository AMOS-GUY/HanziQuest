import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_LENGTH,
  filterExplorerWords,
  foldPinyin,
  parseExplorerFilter,
  type ExplorerWord,
} from "@/features/learning/vocabulary-search";

function word(partial: Partial<ExplorerWord> & Pick<ExplorerWord, "id" | "simplified">) {
  return {
    pinyin: "",
    meaning: "",
    partOfSpeech: null,
    audioUrl: null,
    hsk20Level: null,
    provisional: true,
    characters: [...partial.simplified],
    ...partial,
    lessonId: partial.lessonId ?? "l1",
    lessonIds: partial.lessonIds ?? [partial.lessonId ?? "l1"],
  } satisfies ExplorerWord;
}

const WORDS = [
  word({ id: "1", simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello" }),
  word({ id: "2", simplified: "好", pinyin: "hǎo", meaning: "good; well" }),
  word({ id: "3", simplified: "女", pinyin: "nǚ", meaning: "woman", lessonId: "l2" }),
  word({ id: "4", simplified: "谢谢", pinyin: "xièxie", meaning: "thank you", lessonId: "l2" }),
];

const ids = (ws: ExplorerWord[]) => ws.map((w) => w.id);

describe("foldPinyin", () => {
  it("removes tones, spaces and case", () => {
    expect(foldPinyin("Nǐ hǎo")).toBe("nihao");
    expect(foldPinyin("ni3 hao3")).toBe("nihao");
    expect(foldPinyin("xiè'xie")).toBe("xiexie");
  });
  it("folds ü, u: and v together", () => {
    expect(foldPinyin("nǚ")).toBe("nu");
    expect(foldPinyin("nu:3")).toBe("nu");
    expect(foldPinyin("nv")).toBe("nu");
  });
});

describe("parseExplorerFilter", () => {
  it("trims, bounds and drops empty values", () => {
    expect(parseExplorerFilter({ q: "  hao ", lesson: "" })).toEqual({
      q: "hao",
      lessonId: undefined,
    });
    expect(parseExplorerFilter({}).q).toBeUndefined();
    expect(parseExplorerFilter({ q: "x".repeat(500) }).q).toHaveLength(MAX_QUERY_LENGTH);
  });
  it("ignores non-string input such as repeated query parameters", () => {
    expect(parseExplorerFilter({ q: ["a", "b"], lesson: ["l1"] })).toEqual({
      q: undefined,
      lessonId: undefined,
    });
  });
});

describe("filterExplorerWords", () => {
  it("returns everything without a filter", () => {
    expect(ids(filterExplorerWords(WORDS, {}))).toEqual(["1", "2", "3", "4"]);
  });
  it("matches Hanzi", () => {
    expect(ids(filterExplorerWords(WORDS, { q: "好" }))).toEqual(["1", "2"]);
  });
  it("matches pinyin with or without tones and spaces", () => {
    for (const q of ["ni hao", "nihao", "ni3hao3", "nǐ hǎo", "NI HAO"])
      expect(ids(filterExplorerWords(WORDS, { q }))).toEqual(["1"]);
    expect(ids(filterExplorerWords(WORDS, { q: "nv" }))).toEqual(["3"]);
  });
  it("matches English meanings case-insensitively", () => {
    expect(ids(filterExplorerWords(WORDS, { q: "Thank" }))).toEqual(["4"]);
  });
  it("narrows by lesson and combines with the query", () => {
    expect(ids(filterExplorerWords(WORDS, { lessonId: "l2" }))).toEqual(["3", "4"]);
    expect(ids(filterExplorerWords(WORDS, { lessonId: "l2", q: "hao" }))).toEqual([]);
  });
  it("keeps a word the filtered lesson shares with an earlier one, listed under that lesson", () => {
    const shared = word({ id: "5", simplified: "猫", lessonId: "l1", lessonIds: ["l1", "l2"] });
    const result = filterExplorerWords([...WORDS, shared], { lessonId: "l2" });
    expect(ids(result)).toEqual(["3", "4", "5"]);
    expect(result.every((w) => w.lessonId === "l2")).toBe(true);
    // Unfiltered, it stays under its first lesson.
    expect(filterExplorerWords([shared], {})[0]!.lessonId).toBe("l1");
  });
  it("matches nothing for an unknown lesson id", () => {
    expect(filterExplorerWords(WORDS, { lessonId: "not-a-lesson" })).toEqual([]);
  });
  it("treats a query of only tone digits or punctuation as text, not as match-all", () => {
    expect(filterExplorerWords(WORDS, { q: "3" })).toEqual([]);
  });
});
