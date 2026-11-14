import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkSources,
  compareLists,
  parseSourceRegister,
  sourceRegister,
  type SourceRegister,
} from "@/features/curriculum/sources";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { curriculumContentSchema } from "@/features/curriculum/content-schema";
import { loadStrokeData, type StrokeData } from "@/features/curriculum/stroke-data";
import { LOOKALIKE, PILOT_CHARACTERS, pilotPlan } from "@/features/handwriting/pilot";
import { PILOT_CONSENT_FORMS, currentConsentForm } from "@/features/handwriting/consent";
import { OBSERVATIONS } from "@/features/handwriting/sample-options";
import { hasPermission, ROLE_PERMISSIONS } from "@/lib/permissions/permissions";

const fake: StrokeData = {
  strokes: ["M 0 0"],
  medians: [
    [
      [0, 0],
      [1, 1],
    ],
  ],
};

const approvedList = {
  id: "fixture-hsk30-l1",
  title: "Synthetic fixture list (not a real HSK list)",
  kind: "OFFICIAL_LIST",
  publisher: "test fixture",
  licenseStatus: "LICENSED",
  license: "fixture",
  obligations: [],
  provides: ["membership"],
  approval: { status: "APPROVED", approverRole: "SUPER_ADMIN", approvedOn: "2026-11-12" },
} as const;

function register(extra: unknown[] = []): SourceRegister {
  return parseSourceRegister({
    sources: [...sourceRegister().sources, ...extra],
  });
}

function content(overrides: {
  curriculum?: Record<string, unknown>;
  word?: Record<string, unknown>;
  character?: Record<string, unknown>;
}) {
  return curriculumContentSchema.parse({
    curriculum: {
      slug: "t",
      name: "T",
      framework: "CUSTOM",
      version: "1",
      source: "unit",
      sourceRefs: ["hanziquest-authored"],
      licenseStatus: "ORIGINAL",
      verification: "PROVISIONAL",
      ...overrides.curriculum,
    },
    level: { level: 1, name: "L1" },
    characters: {
      你: { pinyin: "nǐ", meaning: "you", ...overrides.character },
      好: { pinyin: "hǎo", meaning: "good" },
    },
    units: [
      {
        slug: "u",
        title: "U",
        lessons: [
          {
            slug: "l",
            title: "L",
            words: [{ simplified: "你好", pinyin: "nǐ hǎo", meaning: "hello", ...overrides.word }],
          },
        ],
      },
    ],
  });
}

const errors = (c: ReturnType<typeof content>, r = register()) =>
  checkSources(c, r)
    .filter((i) => i.severity === "error")
    .map((i) => i.message);

describe("source register", () => {
  it("the repository register is valid, and nothing in it is approved or an HSK list", () => {
    const r = sourceRegister();
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.sources.every((s) => s.approval.status === "PENDING")).toBe(true);
    expect(r.sources.some((s) => s.provides.includes("membership"))).toBe(false);
  });

  it("rejects duplicates, approval without role and date, and membership from non-lists", () => {
    const base = sourceRegister().sources[0]!;
    expect(() => parseSourceRegister({ sources: [base, base] })).toThrow();
    expect(() =>
      parseSourceRegister({
        sources: [{ ...base, id: "x-1", approval: { status: "APPROVED" } }],
      }),
    ).toThrow();
    expect(() =>
      parseSourceRegister({ sources: [{ ...base, id: "x-2", provides: ["membership"] }] }),
    ).toThrow();
  });
});

describe("content source checks", () => {
  it("passes the starter curriculum with zero new errors or warnings", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.resolve("content/hsk1-starter.json"), "utf8"),
    ) as unknown;
    const withRegister = validateCurriculumContent(raw, loadStrokeData, sourceRegister());
    const without = validateCurriculumContent(raw, loadStrokeData);
    expect(withRegister.ok).toBe(true);
    expect(withRegister.issues).toEqual(without.issues);
  });

  it("no longer claims the starter follows an unrecorded HSK list", () => {
    const text = fs.readFileSync(path.resolve("content/hsk1-starter.json"), "utf8");
    expect(text).not.toMatch(/a public list/);
    expect(text).not.toMatch(/"hsk20Level"|"hsk30Level"|"editions"/);
  });

  it("requires registered curriculum sources", () => {
    expect(errors(content({ curriculum: { sourceRefs: [] } }))).toContain(
      "Cite at least one registered source for the curriculum",
    );
    expect(errors(content({ curriculum: { sourceRefs: ["made-up"] } }))[0]).toMatch(
      /not in the source register/,
    );
  });

  it("refuses fields a source may not supply", () => {
    expect(errors(content({ word: { sourceRefs: ["hanzi-writer-data-2.0.1"] } }))[0]).toMatch(
      /may not supply reading or gloss/,
    );
  });

  it("refuses REVIEWED or VERIFIED declared by a file, even with approved sources (D-074)", () => {
    // The schema itself refuses them: no register, approval or licence can make them valid.
    for (const verification of ["REVIEWED", "VERIFIED"])
      expect(() => content({ curriculum: { verification } })).toThrow(
        /may only declare PROVISIONAL/,
      );
  });

  it("refuses HSK level tags without an approved list source", () => {
    const tagged = content({
      word: { editions: { sourceRef: "hanziquest-authored", hsk20Level: 1 } },
    });
    expect(errors(tagged)[0]).toMatch(/approved list source/);
    const unknown = content({ word: { editions: { sourceRef: "nope", hsk30Level: 1 } } });
    expect(errors(unknown)[0]).toMatch(/not in the source register/);
  });

  it("accepts tags from an approved list and never mixes editions", () => {
    const r = register([approvedList]);
    const ok = content({
      curriculum: { framework: "HSK_3_0" },
      word: { editions: { sourceRef: approvedList.id, hsk30Level: 1 } },
      character: {
        editions: { sourceRef: approvedList.id, hsk30Level: 1, hsk30Handwriting: true },
      },
    });
    expect(errors(ok, r)).toEqual([]);
    const mixed = content({
      curriculum: { framework: "HSK_2_0" },
      word: { editions: { sourceRef: approvedList.id, hsk30Level: 1 } },
    });
    expect(errors(mixed, r)[0]).toMatch(/no HSK 2.0 level tag/);
  });

  it("checks example provenance", () => {
    const example = (e: Record<string, unknown>) =>
      content({
        word: {
          example: {
            zh: "你好！",
            pinyin: "nǐ hǎo!",
            en: "Hello!",
            sourceRef: "hanziquest-authored",
            verification: "PROVISIONAL",
            ...e,
          },
        },
      });
    expect(errors(example({}))).toEqual([]);
    expect(errors(example({ zh: "早上好" }))[0]).toMatch(/doesn't contain/);
    expect(errors(example({ sourceRef: "hanzi-writer-data-2.0.1" }))[0]).toMatch(
      /may not supply example/,
    );
    // A file can't declare an example REVIEWED or VERIFIED either (D-074).
    expect(() => example({ verification: "VERIFIED" })).toThrow(/may only declare PROVISIONAL/);
    expect(() => example({ verification: "REVIEWED" })).toThrow(/may only declare PROVISIONAL/);
    expect(() => example({ zh: "nihao" })).toThrow();
  });

  it("is enforced by the validator when a register is given", () => {
    const raw = {
      ...content({}),
      curriculum: { ...content({}).curriculum, sourceRefs: ["made-up"] },
    };
    expect(validateCurriculumContent(raw, () => fake, sourceRegister()).ok).toBe(false);
  });
});

describe("edition mapping (dry run)", () => {
  it("reports overlaps and differences on synthetic lists", () => {
    expect(compareLists(["你", "好", "我"], ["我", "他", "你", "你"])).toEqual({
      onlyInA: ["好"],
      onlyInB: ["他"],
      inBoth: ["你", "我"].sort((a, b) => a.localeCompare(b, "zh")),
    });
  });
});

describe("M12 pilot rules", () => {
  it("rotates every error type 10 times across P01–P05 (protocol item 8)", () => {
    const counts = new Map<string, number>();
    for (const code of ["P01", "P02", "P03", "P04", "P05"]) {
      const plan = pilotPlan(code);
      expect(plan).toHaveLength(36);
      for (const p of plan.filter((x) => x.category !== "CORRECT"))
        counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it("has stroke data for every pilot character and look-alike", () => {
    for (const h of PILOT_CHARACTERS) {
      expect(loadStrokeData(h), h).not.toBeNull();
      expect(loadStrokeData(LOOKALIKE[h]), LOOKALIKE[h]).not.toBeNull();
    }
  });

  it("keeps the current consent form an unapproved draft until the owner approves it", () => {
    expect(currentConsentForm().ownerApproved).toBe(false);
    expect(new Set(PILOT_CONSENT_FORMS.map((f) => f.version)).size).toBe(
      PILOT_CONSENT_FORMS.length,
    );
  });

  it("mirrors the Prisma observation enum", async () => {
    const schema = fs.readFileSync(path.resolve("prisma/schema.prisma"), "utf8");
    const block = /enum HandwritingObservation \{([^}]*)\}/.exec(schema)![1]!;
    expect(block.trim().split(/\s+/)).toEqual([...OBSERVATIONS]);
  });

  it("gives erasure to super admins only", () => {
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, perms]) => perms.includes("handwriting:erase"))
      .map(([role]) => role);
    expect(holders).toEqual(["SUPER_ADMIN"]);
    expect(hasPermission(["CURRICULUM_EDITOR"], "handwriting:erase")).toBe(false);
  });
});
