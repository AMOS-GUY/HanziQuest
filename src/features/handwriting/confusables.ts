/**
 * Confusable-character diagnostics (M13). DIAGNOSTIC ONLY: nothing here changes how learners
 * are graded. It runs the unchanged engine on seeded SYNTHETIC ink and records what happens
 * when a visually similar character is written in place of the expected one.
 *
 * - Every result is labelled `source: "synthetic"`. Synthetic ink follows the reference
 *   strokes closely, so these results describe the engine's geometry, not accuracy with real
 *   learners (docs/M13_HANDWRITING_DIAGNOSTICS.md).
 * - Pairs come from documented groups with their provenance (`CONFUSABLE_GROUPS`). They are
 *   not a universal confusable list.
 * - Identity is decided against a candidate set (for learners: their level's characters). A
 *   submitted look-alike outside that set can only be caught by geometry, so each case records
 *   whether the submitted character is in the set.
 */
import { createHash } from "node:crypto";
import { evaluateCharacter, ENGINE_VERSION, THRESHOLDS } from "./evaluate";
import { LOOKALIKE } from "./pilot";
import { fromMakeMeAHanzi } from "./reference";
import { toInk, type InkOptions } from "./synthetic-ink";
import type { EvaluationBand, ReferenceCharacter } from "./types";
import { DEFAULT_EVALUATION_WEIGHTS } from "@/features/exercises/evaluation-config";

export type GroupProvenance = "roadmap-m13" | "m12-pilot-lookalike" | "engineering-screen";

export interface ConfusableGroup {
  chars: readonly string[];
  provenance: GroupProvenance;
}

/**
 * How the groups were selected (docs/M13_HANDWRITING_DIAGNOSTICS.md, "Pair selection"):
 * - roadmap-m13: the pairs named in docs/ROADMAP.md (M13 scope).
 * - m12-pilot-lookalike: the look-alikes the M12 pilot asks participants to write
 *   (`LOOKALIKE` in pilot.ts), so the suite and the pilot stay in step.
 * - engineering-screen: an engineer's visual screen (2026-11-13) for characters that differ
 *   from an HSK 1 Starter character by one stroke, a stroke's length or its position.
 *   Not exhaustive and not reviewed by a teacher.
 */
export const CONFUSABLE_GROUPS: readonly ConfusableGroup[] = [
  { chars: ["他", "她"], provenance: "roadmap-m13" },
  { chars: ["人", "八", "入"], provenance: "roadmap-m13" },
  { chars: ["日", "目", "白"], provenance: "roadmap-m13" },
  { chars: ["土", "士"], provenance: "roadmap-m13" },
  { chars: ["己", "已", "巳"], provenance: "roadmap-m13" },
  ...Object.entries(LOOKALIKE).map(([a, b]) => ({
    chars: [a, b],
    provenance: "m12-pilot-lookalike" as const,
  })),
  { chars: ["天", "夫", "大", "太", "犬"], provenance: "engineering-screen" },
  { chars: ["午", "牛", "年"], provenance: "engineering-screen" },
  { chars: ["子", "了", "孑"], provenance: "engineering-screen" },
  { chars: ["王", "玉", "主", "五"], provenance: "engineering-screen" },
  { chars: ["我", "找"], provenance: "engineering-screen" },
  { chars: ["十", "千", "干"], provenance: "engineering-screen" },
  { chars: ["未", "末", "本"], provenance: "engineering-screen" },
  { chars: ["儿", "几", "九"], provenance: "engineering-screen" },
  { chars: ["少", "小"], provenance: "engineering-screen" },
  { chars: ["今", "令"], provenance: "engineering-screen" },
  { chars: ["生", "牛"], provenance: "engineering-screen" },
  { chars: ["口", "日", "中"], provenance: "engineering-screen" },
  { chars: ["上", "下", "卡"], provenance: "engineering-screen" },
];

/** Fixed seeds and ink options: the same inputs always give the same results. */
export const SUITE_SEEDS = [1, 2, 3, 4, 5] as const;
export const SUITE_INK: Readonly<Omit<InkOptions, "seed">> = { jitter: 0.008, wobble: 0.01 };

/** Short fingerprint of everything that decides a verdict: engine version, thresholds, weights. */
export function engineConfigId(weights = DEFAULT_EVALUATION_WEIGHTS) {
  return createHash("sha256")
    .update(JSON.stringify({ engine: ENGINE_VERSION, thresholds: THRESHOLDS, weights }))
    .digest("hex")
    .slice(0, 12);
}

export type CaseOutcome =
  "false-acceptance" | "rejected-identity" | "rejected-structure" | "accepted" | "false-rejection";

export interface ConfusableCase {
  source: "synthetic";
  kind: "confusable" | "control";
  expected: string;
  submitted: string;
  submittedInCandidateSet: boolean;
  seed: number;
  engineVersion: string;
  configId: string;
  candidateCount: number;
  band: EvaluationBand;
  score: number;
  identityVerified: boolean;
  bestMatch: string | null;
  accepted: boolean;
  outcome: CaseOutcome;
}

export interface ConfusablePairSummary {
  expected: string;
  submitted: string;
  submittedInCandidateSet: boolean;
  provenance: GroupProvenance[];
  trials: number;
  falseAcceptances: number;
  rejectedIdentity: number;
  rejectedStructure: number;
}

export interface ConfusableReport {
  source: "synthetic";
  engineVersion: string;
  configId: string;
  seeds: readonly number[];
  candidateCount: number;
  cases: ConfusableCase[];
  pairs: ConfusablePairSummary[];
  /** Characters skipped because they have no stroke data (no reference to write or check). */
  missingReferences: string[];
  totals: {
    confusableTrials: number;
    falseAcceptances: number;
    falseAcceptancesInSet: number;
    falseAcceptancesOutOfSet: number;
    controlTrials: number;
    falseRejections: number;
  };
}

const ACCEPTED_BANDS: readonly EvaluationBand[] = ["EXCELLENT", "GOOD"];

/** Ordered (submitted → expected) pairs whose expected character is taught. Deduplicated. */
export function confusablePairs(
  taught: ReadonlySet<string>,
  groups: readonly ConfusableGroup[] = CONFUSABLE_GROUPS,
) {
  const pairs = new Map<
    string,
    { expected: string; submitted: string; provenance: Set<GroupProvenance> }
  >();
  for (const g of groups)
    for (const expected of g.chars)
      for (const submitted of g.chars) {
        if (expected === submitted || !taught.has(expected)) continue;
        const key = `${submitted}>${expected}`;
        const entry = pairs.get(key) ?? { expected, submitted, provenance: new Set() };
        entry.provenance.add(g.provenance);
        pairs.set(key, entry);
      }
  return [...pairs.values()]
    .map((p) => ({ ...p, provenance: [...p.provenance].sort() }))
    .sort((a, b) =>
      a.expected === b.expected
        ? a.submitted.localeCompare(b.submitted, "zh")
        : a.expected.localeCompare(b.expected, "zh"),
    );
}

/**
 * Runs the suite. `taught` are the characters learners are asked to write; `candidateSet` is
 * what identity is checked against (for a curriculum level: its characters with stroke data).
 * `lookup` returns reference medians, or null when there is no stroke data.
 */
export function runConfusableSuite(options: {
  taught: Iterable<string>;
  candidateSet: Iterable<string>;
  lookup: (hanzi: string) => number[][][] | null;
  groups?: readonly ConfusableGroup[];
  seeds?: readonly number[];
}): ConfusableReport {
  const seeds = options.seeds ?? SUITE_SEEDS;
  const configId = engineConfigId();
  const refCache = new Map<string, ReferenceCharacter | null>();
  const ref = (h: string) => {
    if (!refCache.has(h)) {
      const medians = options.lookup(h);
      refCache.set(h, medians ? fromMakeMeAHanzi(h, medians) : null);
    }
    return refCache.get(h)!;
  };
  const missing = new Set<string>();
  const candidateHanzi = [...new Set(options.candidateSet)].sort();
  const candidates = candidateHanzi.flatMap((h) => {
    const r = ref(h);
    if (!r) missing.add(h);
    return r ? [r] : [];
  });
  const inSet = new Set(candidates.map((c) => c.hanzi));
  const taught = new Set(options.taught);
  const cases: ConfusableCase[] = [];
  const pairs: ConfusablePairSummary[] = [];

  const evaluateCase = (
    kind: ConfusableCase["kind"],
    expected: ReferenceCharacter,
    submitted: ReferenceCharacter,
    seed: number,
  ): ConfusableCase => {
    const e = evaluateCharacter(toInk(submitted.medians, { ...SUITE_INK, seed }), expected, {
      candidates,
    });
    const accepted = ACCEPTED_BANDS.includes(e.band);
    const outcome: CaseOutcome =
      kind === "control"
        ? accepted
          ? "accepted"
          : "false-rejection"
        : accepted
          ? "false-acceptance"
          : e.identity.verified
            ? "rejected-structure"
            : "rejected-identity";
    return {
      source: "synthetic",
      kind,
      expected: expected.hanzi,
      submitted: submitted.hanzi,
      submittedInCandidateSet: inSet.has(submitted.hanzi),
      seed,
      engineVersion: e.engineVersion,
      configId,
      candidateCount: e.identity.candidateCount,
      band: e.band,
      score: e.score,
      identityVerified: e.identity.verified,
      bestMatch: e.identity.bestMatch,
      accepted,
      outcome,
    };
  };

  const controlled = new Set<string>();
  for (const pair of confusablePairs(taught, options.groups)) {
    const expected = ref(pair.expected);
    const submitted = ref(pair.submitted);
    if (!expected) missing.add(pair.expected);
    if (!submitted) missing.add(pair.submitted);
    if (!expected || !submitted) continue;
    const results = seeds.map((seed) => evaluateCase("confusable", expected, submitted, seed));
    cases.push(...results);
    pairs.push({
      expected: pair.expected,
      submitted: pair.submitted,
      submittedInCandidateSet: inSet.has(pair.submitted),
      provenance: pair.provenance,
      trials: results.length,
      falseAcceptances: results.filter((r) => r.outcome === "false-acceptance").length,
      rejectedIdentity: results.filter((r) => r.outcome === "rejected-identity").length,
      rejectedStructure: results.filter((r) => r.outcome === "rejected-structure").length,
    });
    // Control: the expected character written correctly, same seeds (false rejection).
    if (!controlled.has(pair.expected)) {
      controlled.add(pair.expected);
      cases.push(...seeds.map((seed) => evaluateCase("control", expected, expected, seed)));
    }
  }

  const confusable = cases.filter((c) => c.kind === "confusable");
  const controls = cases.filter((c) => c.kind === "control");
  const fa = confusable.filter((c) => c.outcome === "false-acceptance");
  return {
    source: "synthetic",
    engineVersion: ENGINE_VERSION,
    configId,
    seeds,
    candidateCount: candidates.length,
    cases,
    pairs,
    missingReferences: [...missing].sort(),
    totals: {
      confusableTrials: confusable.length,
      falseAcceptances: fa.length,
      falseAcceptancesInSet: fa.filter((c) => c.submittedInCandidateSet).length,
      falseAcceptancesOutOfSet: fa.filter((c) => !c.submittedInCandidateSet).length,
      controlTrials: controls.length,
      falseRejections: controls.filter((c) => c.outcome === "false-rejection").length,
    },
  };
}
