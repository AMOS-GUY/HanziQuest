/**
 * M13 diagnostics: confusable suite, import diagnostics and the pure replay core.
 * Everything here runs on SYNTHETIC ink. These are regression and determinism tests of the
 * engine's current behaviour, not evidence of accuracy with real learners.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The full-curriculum suite runs a few hundred evaluations; allow it time on slow machines. */
const SUITE_TIMEOUT = 30_000;
import { loadStrokeData } from "@/features/curriculum/stroke-data";
import { curriculumContentSchema } from "@/features/curriculum/content-schema";
import { validateCurriculumContent } from "@/features/curriculum/validate-content";
import { confusableDiagnostics } from "@/features/curriculum/confusable-diagnostics";
import {
  CONFUSABLE_GROUPS,
  confusablePairs,
  engineConfigId,
  runConfusableSuite,
} from "@/features/handwriting/confusables";
import { ENGINE_VERSION, evaluateWord } from "@/features/handwriting/evaluate";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import {
  readOnlyClient,
  ReadOnlyViolation,
  replayAttempt,
  splitOf,
} from "@/features/handwriting/replay";
import { toInk } from "@/features/handwriting/synthetic-ink";
import type { PrismaClient } from "@/generated/prisma/client";

const medians = (h: string) => loadStrokeData(h)?.medians ?? null;
const ref = (h: string) => fromMakeMeAHanzi(h, loadStrokeData(h)!.medians);
const starter = curriculumContentSchema.parse(
  JSON.parse(fs.readFileSync(path.resolve("content/hsk1-starter.json"), "utf8")),
);

describe("confusable suite: preliminary findings (regression)", () => {
  const level = Object.keys(starter.characters);

  it.each([
    ["入", "八"],
    ["王", "五"],
  ])("%s written for %s: accepted when %s is outside the candidate set", (submitted, expected) => {
    const r = runConfusableSuite({
      taught: [expected],
      candidateSet: level,
      lookup: medians,
      groups: [{ chars: [submitted, expected], provenance: "roadmap-m13" }],
    });
    const pair = r.pairs.find((p) => p.submitted === submitted && p.expected === expected)!;
    expect(pair.submittedInCandidateSet).toBe(false);
    // Current behaviour (hq-eval-1): every seeded trial is accepted. If the engine or the
    // candidate rules change, this test must be updated deliberately, with a decision entry.
    expect(pair.falseAcceptances).toBe(pair.trials);
    for (const c of r.cases.filter((x) => x.kind === "confusable" && x.submitted === submitted))
      expect(c).toMatchObject({
        source: "synthetic",
        expected,
        submitted,
        submittedInCandidateSet: false,
        identityVerified: true,
        bestMatch: expected,
        accepted: true,
        outcome: "false-acceptance",
        engineVersion: ENGINE_VERSION,
      });
  });

  it.each([
    ["入", "八"],
    ["夫", "天"],
    ["犬", "天"],
    ["找", "我"],
    ["王", "五"],
    ["牛", "午"],
    ["孑", "子"],
  ])(
    "%s written for %s: rejected by identity once the written character is a candidate",
    (submitted, expected) => {
      const r = runConfusableSuite({
        taught: [expected],
        candidateSet: [...level, submitted],
        lookup: medians,
        groups: [{ chars: [submitted, expected], provenance: "roadmap-m13" }],
      });
      const pair = r.pairs.find((p) => p.submitted === submitted && p.expected === expected)!;
      expect(pair.submittedInCandidateSet).toBe(true);
      expect(pair.falseAcceptances).toBe(0);
      expect(pair.rejectedIdentity).toBe(pair.trials);
    },
  );

  it(
    "HSK 1 Starter: exactly the seven documented out-of-set findings, none in-set, no false rejections",
    () => {
      const d = confusableDiagnostics(starter, loadStrokeData);
      expect(d.risks.map((r) => `${r.submitted}>${r.expected}`).sort()).toEqual(
        ["入>八", "夫>天", "犬>天", "找>我", "王>五", "牛>午", "孑>子"].sort(),
      );
      expect(d.risks.every((r) => !r.submittedInCandidateSet && r.accepted === r.trials)).toBe(
        true,
      );
      expect(d.report.totals.falseAcceptancesInSet).toBe(0);
      expect(d.report.totals.falseRejections).toBe(0);
      expect(d.report.source).toBe("synthetic");
    },
    SUITE_TIMEOUT,
  );

  it(
    "every documented group, fully in the candidate set: only the known 干→千 case is accepted",
    () => {
      const all = [...new Set(CONFUSABLE_GROUPS.flatMap((g) => g.chars))].filter((h) => medians(h));
      const r = runConfusableSuite({ taught: all, candidateSet: all, lookup: medians });
      // Finding F8 (2026-11-13): 干 written for 千 is accepted on seed 1 although both are
      // candidates (identity margin). Neither is in HSK 1 Starter. Recorded, not fixed (no
      // scoring changes in M13); this pins the current behaviour so any change is noticed.
      const accepted = r.cases
        .filter((c) => c.outcome === "false-acceptance")
        .map((c) => `${c.submitted}>${c.expected}#${c.seed}`);
      expect(accepted).toEqual(["干>千#1"]);
      expect(r.totals.falseRejections).toBe(0);
    },
    SUITE_TIMEOUT,
  );
});

describe("confusable suite: reproducibility and records", () => {
  const run = (seeds?: number[]) =>
    runConfusableSuite({
      taught: ["八", "五"],
      candidateSet: ["八", "五", "人"],
      lookup: medians,
      seeds,
    });

  it("gives identical results for identical inputs", () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("different seeds give different ink (scores vary) but are each reproducible", () => {
    const a = run([1]).cases.map((c) => c.score);
    const b = run([2]).cases.map((c) => c.score);
    expect(a).not.toEqual(b);
    expect(run([2]).cases.map((c) => c.score)).toEqual(b);
  });

  it("records expected, submitted, membership, engine, config, outcome, score and band", () => {
    const c = run().cases[0]!;
    for (const key of [
      "expected",
      "submitted",
      "submittedInCandidateSet",
      "engineVersion",
      "configId",
      "candidateCount",
      "band",
      "score",
      "identityVerified",
      "bestMatch",
      "outcome",
      "seed",
    ])
      expect(c).toHaveProperty(key);
    expect(c.configId).toBe(engineConfigId());
  });

  it("separates false acceptance (look-alikes) from false rejection (controls)", () => {
    const r = run();
    expect(r.cases.some((c) => c.kind === "control")).toBe(true);
    expect(
      r.cases.filter((c) => c.kind === "control").every((c) => c.outcome !== "false-acceptance"),
    ).toBe(true);
    expect(
      r.cases.filter((c) => c.kind === "confusable").every((c) => c.outcome !== "false-rejection"),
    ).toBe(true);
  });

  it("deduplicates pairs from overlapping groups and keeps every provenance", () => {
    const pairs = confusablePairs(new Set(["日"]), [
      { chars: ["日", "目"], provenance: "roadmap-m13" },
      { chars: ["目", "日", "白"], provenance: "engineering-screen" },
    ]);
    expect(pairs.filter((p) => p.submitted === "目")).toEqual([
      { expected: "日", submitted: "目", provenance: ["engineering-screen", "roadmap-m13"] },
    ]);
  });

  it("lists characters without stroke data instead of failing", () => {
    const r = runConfusableSuite({
      taught: ["八"],
      candidateSet: ["八"],
      lookup: (h) => (h === "入" ? null : medians(h)),
      groups: [{ chars: ["八", "入"], provenance: "roadmap-m13" }],
    });
    expect(r.missingReferences).toEqual(["入"]);
    expect(r.pairs).toEqual([]);
  });

  it("the configuration id changes with the weights", () => {
    expect(engineConfigId()).toBe(engineConfigId());
    expect(
      engineConfigId({ recognition: 0.5, strokeOrder: 0.2, direction: 0.1, shape: 0.2 }),
    ).not.toBe(engineConfigId());
  });
});

describe("import diagnostics (advisory)", () => {
  const file = (words: string[], characters: Record<string, { pinyin: string; meaning: string }>) =>
    curriculumContentSchema.parse({
      curriculum: {
        slug: "t",
        name: "T",
        framework: "CUSTOM",
        version: "1",
        source: "unit",
        licenseStatus: "ORIGINAL",
        verification: "PROVISIONAL",
      },
      level: { level: 1, name: "L1" },
      characters,
      units: [
        {
          slug: "u",
          title: "U",
          lessons: [
            {
              slug: "l",
              title: "L",
              words: words.map((w) => ({ simplified: w, pinyin: "bā", meaning: w })),
            },
          ],
        },
      ],
    });

  it("explains each risk with both characters and the reason, once per pair", () => {
    const d = confusableDiagnostics(
      file(["八", "八"], { 八: { pinyin: "bā", meaning: "eight" } }),
      loadStrokeData,
    );
    const advisories = d.lines.filter((l) => l.startsWith("Advisory"));
    expect(new Set(advisories).size).toBe(advisories.length);
    const line = advisories.find((l) => l.includes("writing 入 when 八"))!;
    expect(line).toMatch(/isn't in this level's character set/);
    expect(d.lines[0]).toMatch(/synthetic ink, not real handwriting/);
    expect(d.lines[0]).toMatch(/never blocks an import/);
  });

  it("no warning when both look-alikes are taught (identity tells them apart)", () => {
    const d = confusableDiagnostics(
      file(["八", "入"], {
        八: { pinyin: "bā", meaning: "eight" },
        入: { pinyin: "rù", meaning: "enter" },
      }),
      loadStrokeData,
    );
    expect(d.risks.find((r) => r.expected === "八" && r.submitted === "入")).toBeUndefined();
  });

  it("reports characters without stroke data and still produces results", () => {
    const d = confusableDiagnostics(
      file(["八"], { 八: { pinyin: "bā", meaning: "eight" } }),
      (h) => (h === "入" ? null : loadStrokeData(h)),
    );
    expect(d.lines.some((l) => l.startsWith("Not checked (no stroke data): 入"))).toBe(true);
  });

  it(
    "is deterministic and never changes the validation result",
    () => {
      const raw = JSON.parse(fs.readFileSync(path.resolve("content/hsk1-starter.json"), "utf8"));
      const before = validateCurriculumContent(raw, loadStrokeData);
      const a = confusableDiagnostics(starter, loadStrokeData).lines;
      const b = confusableDiagnostics(starter, loadStrokeData).lines;
      expect(a).toEqual(b);
      const after = validateCurriculumContent(raw, loadStrokeData);
      expect(after.ok).toBe(true);
      expect(after.issues).toEqual(before.issues);
    },
    SUITE_TIMEOUT,
  );
});

describe("replay core (pure)", () => {
  const level = ["你", "好", "我", "他"].map(ref);
  const references = new Map(level.map((r) => [r.hanzi, r]));
  const drawings = [toInk(ref("你").medians, { seed: 4 }), toInk(ref("好").medians, { seed: 5 })];
  const stored = evaluateWord(drawings, [ref("你"), ref("好")], { candidates: level });
  const base = {
    attemptId: "a1",
    storedEvaluation: JSON.parse(JSON.stringify(stored)) as unknown,
    strokeData: JSON.parse(JSON.stringify(drawings)) as unknown,
    characters: ["你", "好"],
    references,
    candidates: level,
  };

  it("reproduces a stored evaluation exactly, deterministically, without touching it", () => {
    const frozen = JSON.stringify(base.storedEvaluation);
    const r = replayAttempt(base);
    expect(r).toMatchObject({ status: "identical", diffs: [], deterministic: true });
    expect(r.original).toEqual({
      engineVersion: ENGINE_VERSION,
      band: stored.band,
      score: stored.score,
    });
    expect(JSON.stringify(base.storedEvaluation)).toBe(frozen);
    expect(JSON.stringify(replayAttempt(base))).toBe(JSON.stringify(r));
  });

  it("explains differences: engine version, candidate set, unexplained", () => {
    const old = { ...(base.storedEvaluation as object), engineVersion: "hq-eval-0" };
    expect(replayAttempt({ ...base, storedEvaluation: old }).status).toBe("engine-version-changed");
    const grown = [...level, ref("她")];
    const r = replayAttempt({ ...base, candidates: grown });
    expect(r.status).toBe("candidate-set-changed");
    expect(r.diffs.some((d) => d.field === "characters[0].identity.candidateCount")).toBe(true);
    const tampered = JSON.parse(JSON.stringify(base.storedEvaluation)) as { score: number };
    tampered.score += 1;
    expect(replayAttempt({ ...base, storedEvaluation: tampered }).status).toBe(
      "unexplained-difference",
    );
  });

  it("shows a configuration change as a different config id and score differences", () => {
    const weights = { recognition: 0.7, strokeOrder: 0.1, direction: 0.1, shape: 0.1 };
    const r = replayAttempt({ ...base, weights });
    expect(r.replayed.configId).not.toBe(replayAttempt(base).replayed.configId);
    expect(r.diffs.some((d) => d.field.endsWith("score"))).toBe(true);
  });

  it.each([
    ["missing stroke data", { strokeData: null }],
    ["malformed stroke data", { strokeData: [[{ points: [{ x: "a" }] }]] }],
    ["wrong number of drawings", { strokeData: [base.strokeData as unknown[]][0]!.slice(0, 1) }],
    ["missing stored evaluation", { storedEvaluation: null }],
    ["missing reference", { references: new Map() }],
  ])("refuses %s as invalid input", (_name, change) => {
    const r = replayAttempt({ ...base, ...(change as object) });
    expect(r.status).toBe("invalid-input");
    expect(r.problem).toBeTruthy();
  });
});

describe("read-only client and held-out split", () => {
  const fake = {
    exerciseAttempt: {
      findMany: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      deleteMany: async () => ({}),
    },
    $executeRaw: async () => 0,
    $transaction: async () => undefined,
  } as unknown as PrismaClient;

  it("allows reads and refuses every write", async () => {
    const db = readOnlyClient(fake);
    await expect(db.exerciseAttempt.findMany()).resolves.toEqual([]);
    for (const call of [
      () => db.exerciseAttempt.create({} as never),
      () => db.exerciseAttempt.update({} as never),
      () => db.exerciseAttempt.deleteMany(),
      () => (db.$executeRaw as unknown as () => unknown)(),
      () => db.$transaction([]),
      // $extends would hand back a new, unwrapped client that could write (review R1).
      () => (db.$extends as unknown as () => unknown)(),
      () => (db.$on as unknown as () => unknown)(),
    ])
      expect(call).toThrow(ReadOnlyViolation);
  });

  it("splits by participant, deterministically, about a third held out", () => {
    const codes = Array.from({ length: 300 }, (_, i) => `P${i}`);
    expect(codes.map(splitOf)).toEqual(codes.map(splitOf));
    expect(splitOf("p7")).toBe(splitOf("P7"));
    const held = codes.filter((c) => splitOf(c) === "held-out").length;
    expect(held).toBeGreaterThan(70);
    expect(held).toBeLessThan(130);
  });
});
