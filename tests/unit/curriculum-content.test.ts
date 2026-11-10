import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  countPinyinSyllables,
  validateCurriculumContent,
} from "@/features/curriculum/validate-content";
import { loadStrokeData, type StrokeData } from "@/features/curriculum/stroke-data";
import {
  buildEvaluationConfig,
  DEFAULT_EVALUATION_WEIGHTS,
  evaluationWeightsSchema,
} from "@/features/exercises/evaluation-config";

const fakeStrokes: StrokeData = {
  strokes: ["M 0 0"],
  medians: [
    [
      [0, 0],
      [1, 1],
    ],
  ],
};
const anyStrokes = () => fakeStrokes;

function minimalContent() {
  return {
    curriculum: {
      slug: "test",
      name: "Test",
      framework: "CUSTOM",
      version: "1",
      source: "unit test",
      licenseStatus: "ORIGINAL",
      verification: "PROVISIONAL",
    },
    level: { level: 1, name: "Level 1" },
    characters: {
      你: { pinyin: "nǐ", meaning: "you" },
      好: { pinyin: "hǎo", meaning: "good" },
    },
    units: [
      {
        slug: "u1",
        title: "Unit",
        lessons: [
          {
            slug: "l1",
            title: "Lesson",
            words: [{ simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello" }],
          },
        ],
      },
    ],
  };
}

describe("countPinyinSyllables", () => {
  it.each([
    ["nǐ hǎo", 2],
    ["xièxie", 2],
    ["duìbuqǐ", 3],
    ["méi guānxi", 3],
    ["nǚ'ér", 2],
    ["Hànyǔ", 2],
    ["Zhōngguó", 2],
    ["xiànzài", 2],
    ["shuǐguǒ", 2],
    ["èr", 1],
    ["bú kèqi", 3],
    ["xīngqī", 2],
  ])("%s has %i syllables", (pinyin, expected) => {
    expect(countPinyinSyllables(pinyin)).toBe(expected);
  });
});

describe("validateCurriculumContent", () => {
  it("accepts well-formed content", () => {
    const result = validateCurriculumContent(minimalContent(), anyStrokes);
    expect(result.ok).toBe(true);
    expect(result.stats).toEqual({ units: 1, lessons: 1, words: 1, characters: 2 });
  });

  it("rejects tone numbers in pinyin", () => {
    const content = minimalContent();
    content.units[0]!.lessons[0]!.words[0]!.pinyin = "ni3 hao3";
    expect(validateCurriculumContent(content, anyStrokes).ok).toBe(false);
  });

  it("rejects a word whose characters are not defined", () => {
    const content = minimalContent();
    content.units[0]!.lessons[0]!.words.push({ simplified: "我", pinyin: "wǒ", meaning: "I" });
    const result = validateCurriculumContent(content, anyStrokes);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("我"))).toBe(true);
  });

  it("rejects pinyin with the wrong number of syllables", () => {
    const content = minimalContent();
    content.units[0]!.lessons[0]!.words[0]!.pinyin = "nǐ";
    expect(validateCurriculumContent(content, anyStrokes).ok).toBe(false);
  });

  it("rejects duplicate words and duplicate slugs", () => {
    const content = minimalContent();
    const lesson = content.units[0]!.lessons[0]!;
    content.units[0]!.lessons.push({ ...lesson });
    const result = validateCurriculumContent(content, anyStrokes);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.message).join("\n")).toMatch(/Duplicate lesson slug/);
    expect(result.issues.map((i) => i.message).join("\n")).toMatch(/already appears/);
  });

  it("warns (but does not fail) when stroke data is missing", () => {
    const result = validateCurriculumContent(minimalContent(), () => null);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.severity === "warning")).toHaveLength(2);
  });

  it("rejects non-Chinese text in hanzi fields", () => {
    const content = minimalContent();
    content.units[0]!.lessons[0]!.words[0]!.simplified = "ni";
    expect(validateCurriculumContent(content, anyStrokes).ok).toBe(false);
  });
});

describe("HSK 1 starter content file", () => {
  const file = path.resolve(__dirname, "../../content/hsk1-starter.json");
  const content = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = validateCurriculumContent(content, loadStrokeData);

  it("passes validation with no errors", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("has stroke data for every character", () => {
    expect(result.issues.filter((i) => i.message.includes("stroke data"))).toEqual([]);
  });

  it("is honestly labelled as provisional", () => {
    expect(content.curriculum.verification).toBe("PROVISIONAL");
  });
});

describe("stroke data", () => {
  it("loads known characters with matching stroke and median counts", () => {
    const data = loadStrokeData("你");
    expect(data).not.toBeNull();
    expect(data!.strokes).toHaveLength(7);
    expect(data!.medians).toHaveLength(7);
  });

  it("returns null for unknown input", () => {
    expect(loadStrokeData("ab")).toBeNull();
    expect(loadStrokeData("../package")).toBeNull();
  });
});

describe("evaluation config", () => {
  it("default weights sum to 1 and follow the spec", () => {
    expect(evaluationWeightsSchema.safeParse(DEFAULT_EVALUATION_WEIGHTS).success).toBe(true);
    expect(DEFAULT_EVALUATION_WEIGHTS).toEqual({
      recognition: 0.35,
      strokeOrder: 0.25,
      direction: 0.15,
      shape: 0.25,
    });
  });

  it("rejects weights that do not sum to 1", () => {
    expect(
      evaluationWeightsSchema.safeParse({
        recognition: 0.5,
        strokeOrder: 0.5,
        direction: 0.5,
        shape: 0,
      }).success,
    ).toBe(false);
  });

  it("always enables the character identity gate", () => {
    expect(buildEvaluationConfig("INDEPENDENT", ["你"]).identityGate).toBe(true);
  });
});
