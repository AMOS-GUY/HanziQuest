/** M7: content validation, readings, provenance, word-list coverage and level progression. */
import { describe, expect, it } from "vitest";
import { checkWordReadings, splitPinyin } from "@/features/curriculum/readings";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { compareWithWordList, parseWordList } from "@/features/curriculum/word-list";
import { mayOverwrite, verificationLabel } from "@/features/curriculum/provenance";
import { deriveLessonStates } from "@/features/progression/lesson-states";
import type { StrokeData } from "@/features/curriculum/stroke-data";
import { skillTotals } from "@/features/progress/queries";

const strokes = (): StrokeData => ({ strokes: ["M 0 0"], medians: [[[0, 0]]] });

type Json = Record<string, unknown>;
type Word = Record<string, string>;

function content(): Json {
  return {
    curriculum: {
      slug: "t",
      name: "T",
      framework: "CUSTOM",
      version: "1",
      source: "test",
      licenseStatus: "ORIGINAL",
      verification: "PROVISIONAL",
    },
    level: { level: 1, name: "L1" },
    characters: {
      你: { pinyin: "nǐ", meaning: "you" },
      好: { pinyin: "hǎo", meaning: "good", alternatives: ["hào"] },
      谢: { pinyin: "xiè", meaning: "to thank" },
      不: { pinyin: "bù", meaning: "not" },
      客: { pinyin: "kè", meaning: "guest" },
      气: { pinyin: "qì", meaning: "air" },
    },
    units: [
      {
        slug: "u1",
        title: "U1",
        lessons: [
          {
            slug: "l1",
            title: "L1",
            words: [
              { simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello" },
              { simplified: "谢谢", pinyin: "xièxie", meaning: "thanks" },
              { simplified: "不客气", pinyin: "bú kèqi", meaning: "you are welcome" },
            ],
          },
        ],
      },
    ],
  };
}

function words(c: Json): Word[] {
  return (c.units as { lessons: { words: Word[] }[] }[])[0]!.lessons[0]!.words;
}

const messages = (input: unknown) =>
  validateCurriculumContent(input, strokes).issues.map((i) => `${i.severity}: ${i.message}`);

const READINGS: Record<string, string[]> = {
  你: ["nǐ"],
  好: ["hǎo", "hào"],
  谢: ["xiè"],
  不: ["bù"],
  客: ["kè"],
  气: ["qì"],
};
const readings = (h: string) => READINGS[h];

describe("pinyin syllables and tones", () => {
  it("splits spaced and unspaced pinyin with tones, keeping ü distinct", () => {
    expect(splitPinyin("nǐ hǎo")).toEqual([
      { base: "ni", tone: 3, text: "ni" },
      { base: "hao", tone: 3, text: "hao" },
    ]);
    expect(splitPinyin("xièxie")!.map((s) => [s.base, s.tone])).toEqual([
      ["xie", 4],
      ["xie", 5],
    ]);
    expect(splitPinyin("lǜ")![0]).toMatchObject({ base: "lv", tone: 4 });
    expect(splitPinyin("Běijīng")!.map((s) => s.base)).toEqual(["bei", "jing"]);
    expect(splitPinyin("xī'ān")!.map((s) => s.base)).toEqual(["xi", "an"]);
    expect(splitPinyin("qqq")).toBeNull();
  });

  it("accepts neutral tones, alternatives and 不/一 sandhi", () => {
    expect(checkWordReadings("谢谢", "xièxie", readings)).toEqual([]);
    expect(checkWordReadings("不客气", "bú kèqi", readings)).toEqual([]);
    expect(checkWordReadings("好", "hào", readings)).toEqual([]);
    expect(checkWordReadings("你好", "nǐ hǎo", readings)).toEqual([]);
  });

  it("flags a wrong tone and a reading the character doesn't have", () => {
    const wrongTone = checkWordReadings("你好", "nǐ háo", readings);
    expect(wrongTone).toHaveLength(1);
    expect(wrongTone[0]).toMatchObject({ hanzi: "好", kind: "tone_mismatch" });
    const typo = checkWordReadings("你好", "nǐ hǎi", readings);
    expect(typo[0]).toMatchObject({ hanzi: "好", kind: "unknown_reading" });
  });
});

describe("content validation (M7 rules)", () => {
  it("passes the fixture with no errors and no reading warnings", () => {
    const result = validateCurriculumContent(content(), strokes);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.message.includes("reading"))).toEqual([]);
  });

  it("warns about a syllable that doesn't match the character's readings", () => {
    const c = content();
    words(c)[0]!.pinyin = "nǐ hǎi";
    expect(messages(c)).toContainEqual(expect.stringMatching(/^warning: .*not a reading of 好/));
  });

  it("refuses any declared status but PROVISIONAL, whatever the licence (D-074)", () => {
    for (const licenseStatus of ["UNKNOWN", "ORIGINAL"])
      for (const verification of ["REVIEWED", "VERIFIED"]) {
        const c = content();
        c.curriculum = { ...(c.curriculum as Json), verification, licenseStatus };
        expect(validateCurriculumContent(c, strokes).ok).toBe(false);
        expect(messages(c)).toContainEqual(
          expect.stringMatching(/^error: .*may only declare PROVISIONAL.*review workflow/),
        );
      }
  });

  it("flags multi-syllable character readings and duplicate glosses", () => {
    const c = content();
    const chars = c.characters as Record<string, { pinyin: string; meaning: string }>;
    chars["客"] = { pinyin: "kèrén", meaning: "guest" };
    chars["气"] = { pinyin: "qì", meaning: "guest" };
    const out = messages(c);
    expect(out).toContainEqual(expect.stringMatching(/^error: .*not a single syllable/));
    expect(out).toContainEqual(expect.stringContaining('share the meaning "guest"'));
  });

  it("warns when one lesson introduces too many new characters", () => {
    const c = content();
    const hanzi = [..."一二三四五六七八九十"];
    c.characters = Object.fromEntries(hanzi.map((h) => [h, { pinyin: "yī", meaning: `n${h}` }]));
    (c.units as { lessons: { words: Word[] }[] }[])[0]!.lessons[0]!.words = hanzi.map((h) => ({
      simplified: h,
      pinyin: "yī",
      meaning: `n${h}`,
    }));
    expect(messages(c)).toContainEqual(expect.stringContaining("10 new characters in one lesson"));
  });

  it("rejects a traditional form with the wrong length", () => {
    const c = content();
    words(c)[0]!.traditional = "你";
    expect(validateCurriculumContent(c, strokes).ok).toBe(false);
  });
});

describe("provenance", () => {
  it("never lets a less verified source overwrite a reviewed record", () => {
    expect(mayOverwrite("PROVISIONAL", "PROVISIONAL")).toBe(true);
    expect(mayOverwrite("REVIEWED", "PROVISIONAL")).toBe(false);
    expect(mayOverwrite("VERIFIED", "REVIEWED")).toBe(false);
    expect(mayOverwrite("VERIFIED", "VERIFIED")).toBe(true);
    expect(mayOverwrite("PROVISIONAL", "VERIFIED")).toBe(true);
  });

  it("only labels VERIFIED content as verified", () => {
    expect(verificationLabel("VERIFIED")).toBe("Verified");
    expect(verificationLabel("REVIEWED")).not.toMatch(/^Verified/);
    expect(verificationLabel("PROVISIONAL")).toBe("Provisional content");
  });
});

describe("word-list coverage", () => {
  const list = parseWordList(
    ["# sample list (test only)", "你好\tnǐ hǎo", "谢谢|xièxie", "爸爸（爸）", "", "再见"].join(
      "\n",
    ),
  );

  it("parses entries, variants and optional pinyin", () => {
    expect(list.map((e) => e.forms)).toEqual([["你好"], ["谢谢"], ["爸爸", "爸"], ["再见"]]);
    expect(list[0]!.pinyin).toBe("nǐ hǎo");
    expect(list[2]!.pinyin).toBeNull();
  });

  it("reports words outside the list, missing list words and pinyin differences", () => {
    const parsed = validateCurriculumContent(content(), strokes).content!;
    const report = compareWithWordList(parsed, list);
    expect(report.contentWords).toBe(3);
    expect(report.covered).toBe(2);
    expect(report.notInList.map((w) => w.simplified)).toEqual(["不客气"]);
    expect(report.missing.map((e) => e.forms[0])).toEqual(["爸爸", "再见"]);
    expect(report.pinyinDiffers).toEqual([]);
  });

  it("notices pinyin that differs from the list", () => {
    const parsed = validateCurriculumContent(content(), strokes).content!;
    const report = compareWithWordList(parsed, parseWordList("你好\tní hǎo"));
    expect(report.pinyinDiffers).toEqual([
      { simplified: "你好", content: "nǐ hǎo", list: "ní hǎo" },
    ]);
  });
});

describe("level progression", () => {
  const lessons = [{ id: "a" }, { id: "b" }];

  it("keeps a later level locked until the previous level is finished", () => {
    expect(deriveLessonStates(lessons, new Map(), false).get("a")).toBe("LOCKED");
    expect(deriveLessonStates(lessons, new Map(), true).get("a")).toBe("AVAILABLE");
  });

  it("keeps lessons with progress open even in a locked level", () => {
    const s = deriveLessonStates(lessons, new Map([["a", "COMPLETED"]]), false);
    expect(s.get("a")).toBe("COMPLETED");
    expect(s.get("b")).toBe("AVAILABLE");
  });
});

describe("skill totals keep recall, technique and guided practice apart", () => {
  it("reports null rates until there is evidence", () => {
    expect(skillTotals([])).toEqual({
      guidedAttempts: 0,
      recallAttempts: 0,
      recallRate: null,
      techniqueJudged: 0,
      techniqueRate: null,
    });
  });

  it("never counts guided practice towards recall", () => {
    const totals = skillTotals([
      {
        guidedAttempts: 9,
        independentAttempts: 4,
        independentSuccesses: 3,
        techniqueAttempts: 3,
        techniqueClean: 1,
      },
      {
        guidedAttempts: 1,
        independentAttempts: 0,
        independentSuccesses: 0,
        techniqueAttempts: 0,
        techniqueClean: 0,
      },
    ]);
    expect(totals).toEqual({
      guidedAttempts: 10,
      recallAttempts: 4,
      recallRate: 0.75,
      techniqueJudged: 3,
      techniqueRate: 1 / 3,
    });
  });
});
