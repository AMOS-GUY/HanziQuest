/**
 * Handwriting replay harness (M13). DIAGNOSTIC ONLY and READ-ONLY.
 *
 * Re-scores stored handwriting with the CURRENT engine and compares it with what was stored,
 * without changing anything:
 * - `replayAttempt` (pure): one stored learner attempt, original vs replayed evaluation, with
 *   field-level differences and a classification that explains them.
 * - `replayStoredAttempts`: every stored writing attempt, through a read-only client.
 * - `duplicateReport`: duplicate submissions (the idempotency key, and same-moment repeats).
 * - `sampleSplit`: Handwriting-lab samples split by participant into development and held-out
 *   sets, with the lab's metrics reproduced and an honest sufficiency statement.
 *
 * Nothing here writes: no attempts, evaluations, XP, mastery, schedules, sync state, consent or
 * samples. `readOnlyClient` enforces it at run time; the integration tests check the tables.
 */
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { drawingsSchema } from "@/features/exercises/attempt-schema";
import {
  DEFAULT_EVALUATION_WEIGHTS,
  evaluationWeightsSchema,
  type EvaluationWeights,
} from "@/features/exercises/evaluation-config";
import { engineConfigId } from "./confusables";
import { ENGINE_VERSION, evaluateWord } from "./evaluate";
import { TEST_PARTICIPANT_PREFIX } from "./pilot";
import { fromMakeMeAHanzi } from "./reference";
import { analyseSamples } from "./samples";
import type { InkStroke, ReferenceCharacter, WordEvaluation } from "./types";
import { computeMetrics, MIN_SAMPLES, type ValidationMetrics } from "./validation";

// ─── Read-only client ───────────────────────────────────────────────────────

const READ_METHODS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

export class ReadOnlyViolation extends Error {
  constructor(what: string) {
    super(`Replay is read-only: refused ${what}.`);
    this.name = "ReadOnlyViolation";
  }
}

/** Wraps a client so that any write (or raw statement, or transaction) throws. */
export function readOnlyClient(prisma: PrismaClient): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== "string") return value;
      if (prop.startsWith("$")) {
        if (["$connect", "$disconnect", "$on", "$extends"].includes(prop)) return value;
        return () => {
          throw new ReadOnlyViolation(prop);
        };
      }
      if (value && typeof value === "object") {
        return new Proxy(value, {
          get(model, method, r) {
            const fn = Reflect.get(model, method, r) as unknown;
            if (typeof method !== "string" || typeof fn !== "function") return fn;
            if (READ_METHODS.has(method)) return (fn as (...a: unknown[]) => unknown).bind(model);
            return () => {
              throw new ReadOnlyViolation(`${prop}.${method}`);
            };
          },
        });
      }
      return value;
    },
  }) as PrismaClient;
}

// ─── Pure comparison ────────────────────────────────────────────────────────

export type ReplayStatus =
  | "identical"
  | "engine-version-changed"
  | "candidate-set-changed"
  | "unexplained-difference"
  | "invalid-input";

export interface ReplayDiff {
  field: string;
  original: unknown;
  replayed: unknown;
}

export interface ReplayResult {
  attemptId: string;
  status: ReplayStatus;
  /** Why the input couldn't be replayed (invalid-input only). */
  problem?: string;
  original: { engineVersion: string | null; band: string | null; score: number | null };
  replayed: {
    engineVersion: string;
    configId: string;
    band: string | null;
    score: number | null;
  };
  diffs: ReplayDiff[];
  /** Replaying the same input twice gave identical output. */
  deterministic: boolean;
}

interface StoredCharacter {
  hanzi?: unknown;
  band?: unknown;
  score?: unknown;
  identity?: { verified?: unknown; bestMatch?: unknown; candidateCount?: unknown };
  feedback?: { code?: unknown }[];
}

const codes = (f: unknown) =>
  Array.isArray(f)
    ? f
        .map((x) => (x && typeof x === "object" ? (x as { code?: unknown }).code : undefined))
        .filter((c): c is string => typeof c === "string")
        .sort()
    : [];

/** Field-level differences between a stored and a replayed word evaluation. */
export function compareEvaluations(original: unknown, replayed: WordEvaluation): ReplayDiff[] {
  const o = (original ?? {}) as {
    engineVersion?: unknown;
    band?: unknown;
    score?: unknown;
    characters?: StoredCharacter[];
  };
  const diffs: ReplayDiff[] = [];
  const cmp = (field: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ field, original: a, replayed: b });
  };
  cmp("engineVersion", o.engineVersion, replayed.engineVersion);
  cmp("band", o.band, replayed.band);
  cmp("score", o.score, replayed.score);
  const stored = Array.isArray(o.characters) ? o.characters : [];
  cmp("characters.length", stored.length, replayed.characters.length);
  replayed.characters.forEach((r, i) => {
    const s = stored[i] ?? {};
    const p = `characters[${i}]`;
    cmp(`${p}.hanzi`, s.hanzi, r.hanzi);
    cmp(`${p}.band`, s.band, r.band);
    cmp(`${p}.score`, s.score, r.score);
    cmp(`${p}.identity.verified`, s.identity?.verified, r.identity.verified);
    cmp(`${p}.identity.bestMatch`, s.identity?.bestMatch, r.identity.bestMatch);
    cmp(`${p}.identity.candidateCount`, s.identity?.candidateCount, r.identity.candidateCount);
    cmp(`${p}.feedbackCodes`, codes(s.feedback), codes(r.feedback));
  });
  return diffs;
}

export interface ReplayInput {
  attemptId: string;
  storedEvaluation: unknown;
  strokeData: unknown;
  /** The exercise's characters, in order. */
  characters: readonly string[];
  weights?: EvaluationWeights;
  /** References for the expected characters (missing ones make the input invalid). */
  references: ReadonlyMap<string, ReferenceCharacter>;
  /** Identity candidates now (the level's characters). */
  candidates: readonly ReferenceCharacter[];
}

/** Replays one stored attempt. Pure and deterministic; never touches the stored record. */
export function replayAttempt(input: ReplayInput): ReplayResult {
  const stored = (input.storedEvaluation ?? {}) as {
    engineVersion?: unknown;
    band?: unknown;
    score?: unknown;
  };
  const weights = input.weights ?? DEFAULT_EVALUATION_WEIGHTS;
  const configId = engineConfigId(weights);
  const original = {
    engineVersion: typeof stored.engineVersion === "string" ? stored.engineVersion : null,
    band: typeof stored.band === "string" ? stored.band : null,
    score: typeof stored.score === "number" ? stored.score : null,
  };
  const invalid = (problem: string): ReplayResult => ({
    attemptId: input.attemptId,
    status: "invalid-input",
    problem,
    original,
    replayed: { engineVersion: ENGINE_VERSION, configId, band: null, score: null },
    diffs: [],
    deterministic: true,
  });

  const drawings = drawingsSchema.safeParse(input.strokeData);
  if (!drawings.success) return invalid("stroke data is missing or malformed");
  if (drawings.data.length !== input.characters.length)
    return invalid(
      `${drawings.data.length} drawing(s) for ${input.characters.length} character(s)`,
    );
  if (!original.engineVersion || !Array.isArray((stored as { characters?: unknown }).characters))
    return invalid("the stored evaluation is missing or isn't a handwriting evaluation");
  const expected: ReferenceCharacter[] = [];
  for (const h of input.characters) {
    const ref = input.references.get(h);
    if (!ref) return invalid(`no reference stroke data for ${h}`);
    expected.push(ref);
  }

  const run = () =>
    evaluateWord(drawings.data as InkStroke[][], expected, {
      weights,
      candidates: input.candidates,
    });
  const replayed = run();
  const deterministic = JSON.stringify(run()) === JSON.stringify(replayed);
  const diffs = compareEvaluations(input.storedEvaluation, replayed);
  const status: ReplayStatus =
    diffs.length === 0
      ? "identical"
      : original.engineVersion !== ENGINE_VERSION
        ? "engine-version-changed"
        : diffs.some((d) => d.field.endsWith("identity.candidateCount"))
          ? "candidate-set-changed"
          : "unexplained-difference";
  return {
    attemptId: input.attemptId,
    status,
    original,
    replayed: {
      engineVersion: ENGINE_VERSION,
      configId,
      band: replayed.band,
      score: replayed.score,
    },
    diffs,
    deterministic,
  };
}

// ─── Stored attempts (read-only) ────────────────────────────────────────────

export interface AttemptReplayReport {
  engineVersion: string;
  attempts: number;
  byStatus: Record<ReplayStatus, number>;
  nondeterministic: number;
  results: ReplayResult[];
}

async function levelReferences(db: PrismaClient, levelId: string) {
  const rows = await db.character.findMany({
    where: { hasStrokeData: true, lessons: { some: { lesson: { unit: { levelId } } } } },
    select: { hanzi: true, strokes: { orderBy: { strokeIndex: "asc" }, select: { median: true } } },
  });
  return rows.map((r) =>
    fromMakeMeAHanzi(
      r.hanzi,
      r.strokes.map((s) => s.median as number[][]),
    ),
  );
}

/**
 * Replays stored handwriting attempts (those with stroke data) against the current engine and
 * the level's CURRENT characters. Read-only: pass any client; it is wrapped.
 */
export async function replayStoredAttempts(
  prisma: PrismaClient,
  options: { limit?: number; attemptIds?: readonly string[] } = {},
): Promise<AttemptReplayReport> {
  const db = readOnlyClient(prisma);
  const attempts = await db.exerciseAttempt.findMany({
    where: {
      strokeData: { not: Prisma.DbNull },
      ...(options.attemptIds ? { id: { in: [...options.attemptIds] } } : {}),
    },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    take: options.limit ?? 5000,
    select: {
      id: true,
      strokeData: true,
      evaluation: true,
      exercise: {
        select: {
          evaluationConfig: true,
          lessons: {
            orderBy: { lessonId: "asc" },
            take: 1,
            select: { lesson: { select: { unit: { select: { levelId: true } } } } },
          },
        },
      },
    },
  });

  const levels = new Map<string, ReferenceCharacter[]>();
  const extra = new Map<string, ReferenceCharacter | null>();
  const results: ReplayResult[] = [];
  for (const a of attempts) {
    const config = (a.exercise.evaluationConfig ?? {}) as {
      characters?: unknown;
      weights?: unknown;
    };
    const characters = Array.isArray(config.characters)
      ? config.characters.filter((c): c is string => typeof c === "string")
      : [];
    const weights = evaluationWeightsSchema.safeParse(config.weights);
    const levelId = a.exercise.lessons[0]?.lesson.unit.levelId;
    let candidates: ReferenceCharacter[] = [];
    if (levelId) {
      if (!levels.has(levelId)) levels.set(levelId, await levelReferences(db, levelId));
      candidates = levels.get(levelId)!;
    }
    const references = new Map(candidates.map((c) => [c.hanzi, c]));
    for (const h of characters) {
      if (references.has(h)) continue;
      if (!extra.has(h)) {
        const row = await db.character.findUnique({
          where: { hanzi: h },
          select: { strokes: { orderBy: { strokeIndex: "asc" }, select: { median: true } } },
        });
        extra.set(
          h,
          row && row.strokes.length
            ? fromMakeMeAHanzi(
                h,
                row.strokes.map((s) => s.median as number[][]),
              )
            : null,
        );
      }
      const ref = extra.get(h);
      if (ref) references.set(h, ref);
    }
    results.push(
      levelId
        ? replayAttempt({
            attemptId: a.id,
            storedEvaluation: a.evaluation,
            strokeData: a.strokeData,
            characters,
            weights: weights.success ? weights.data : undefined,
            references,
            candidates,
          })
        : {
            ...replayAttempt({
              attemptId: a.id,
              storedEvaluation: a.evaluation,
              strokeData: null,
              characters,
              references,
              candidates,
            }),
            problem: "the exercise is no longer in any lesson (level unknown)",
          },
    );
  }
  const byStatus: Record<ReplayStatus, number> = {
    identical: 0,
    "engine-version-changed": 0,
    "candidate-set-changed": 0,
    "unexplained-difference": 0,
    "invalid-input": 0,
  };
  for (const r of results) byStatus[r.status] += 1;
  return {
    engineVersion: ENGINE_VERSION,
    attempts: results.length,
    byStatus,
    nondeterministic: results.filter((r) => !r.deterministic).length,
    results,
  };
}

// ─── Duplicates (read-only) ─────────────────────────────────────────────────

/**
 * Duplicate submissions. `clientEventId` is unique, so a re-sent attempt is stored once; this
 * also counts groups with the same learner, exercise and client time under different ids
 * (possible double submissions). Counts only: no learner identifiers.
 */
export async function duplicateReport(prisma: PrismaClient) {
  const db = readOnlyClient(prisma);
  const [byEvent, byMoment, total] = await Promise.all([
    db.exerciseAttempt.groupBy({
      by: ["clientEventId"],
      _count: { _all: true },
      having: { clientEventId: { _count: { gt: 1 } } },
    }),
    db.exerciseAttempt.groupBy({
      by: ["userId", "exerciseId", "occurredAt"],
      _count: { _all: true },
      having: { exerciseId: { _count: { gt: 1 } } },
    }),
    db.exerciseAttempt.count(),
  ]);
  return {
    attempts: total,
    duplicateClientEventIds: byEvent.length,
    sameMomentGroups: byMoment.length,
    sameMomentExtraAttempts: byMoment.reduce((n, g) => n + g._count._all - 1, 0),
  };
}

// ─── Held-out split of lab samples (read-only) ──────────────────────────────

/** Deterministic participant-level split: about a third of participant codes are held out. */
export function splitOf(participantCode: string): "development" | "held-out" {
  const h = createHash("sha256").update(participantCode.toUpperCase()).digest();
  return h[0]! % 3 === 0 ? "held-out" : "development";
}

/** Minimums before any threshold change (HANDWRITING_VALIDATION.md); the lab's own constant. */
export const VALIDATION_MINIMUM = MIN_SAMPLES;

/** Metrics without the per-participant breakdown, whose keys are participant codes. */
function withoutParticipants(m: ValidationMetrics) {
  const { participant, ...breakdowns } = m.breakdowns;
  return { ...m, breakdowns, participants: participant.length };
}

export async function sampleSplit(prisma: PrismaClient, options: { includeTests?: boolean } = {}) {
  const db = readOnlyClient(prisma);
  const { samples, metrics } = await analyseSamples(db, 20_000, {
    includeTests: options.includeTests ?? false,
  });
  const describe = (name: "development" | "held-out") => {
    const set = samples.filter((s) => splitOf(s.participant) === name);
    const participants = new Set(set.map((s) => s.participant));
    const correct = set.filter((s) => s.category === "CORRECT").length;
    return {
      participants: participants.size,
      samples: set.length,
      correct,
      incorrect: set.length - correct,
      metrics: withoutParticipants(computeMetrics(set)),
      codes: participants,
    };
  };
  const development = describe("development");
  const heldOut = describe("held-out");
  const overlap = [...development.codes].filter((c) => heldOut.codes.has(c)).length;
  const all = computeMetrics(samples);
  const testCodes = samples.filter((s) => s.participant.startsWith(TEST_PARTICIPANT_PREFIX)).length;
  const reasons: string[] = [];
  const participants = development.participants + heldOut.participants;
  if (participants < VALIDATION_MINIMUM.participants)
    reasons.push(
      `${participants} participant(s); at least ${VALIDATION_MINIMUM.participants} are needed`,
    );
  if (development.correct + heldOut.correct < VALIDATION_MINIMUM.correct)
    reasons.push(
      `${development.correct + heldOut.correct} correct samples; at least ${VALIDATION_MINIMUM.correct} are needed`,
    );
  if (development.incorrect + heldOut.incorrect < VALIDATION_MINIMUM.incorrect)
    reasons.push(
      `${development.incorrect + heldOut.incorrect} incorrect samples; at least ${VALIDATION_MINIMUM.incorrect} are needed`,
    );
  if (heldOut.participants === 0) reasons.push("no participant falls in the held-out third");
  if (testCodes > 0)
    reasons.push(
      `${testCodes} sample(s) are TEST rehearsal or automated samples, not real participants`,
    );
  // Participant codes stay out of the report (counts only).
  const strip = (d: ReturnType<typeof describe>) => {
    const { codes, ...rest } = d;
    void codes;
    return rest;
  };
  return {
    source: options.includeTests
      ? "lab samples, including TEST codes"
      : "lab samples from human participants (TEST codes excluded)",
    engineVersion: ENGINE_VERSION,
    total: samples.length,
    development: strip(development),
    heldOut: strip(heldOut),
    /** Writers appearing in both sets. Always 0 by construction (split by participant). */
    writerOverlap: overlap,
    /** Metrics over all samples (participant breakdown removed: codes stay out of reports). */
    allMetrics: withoutParticipants(all),
    reproducesLabMetrics: JSON.stringify(all) === JSON.stringify(metrics),
    sufficientForValidation: reasons.length === 0,
    insufficientBecause: reasons,
  };
}
