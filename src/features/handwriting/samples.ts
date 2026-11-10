/** Recording and analysing labelled handwriting samples (server side). */
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { DomainError, type Actor } from "@/features/administration/services";
import { inkStrokeSchema } from "@/features/exercises/attempt-schema";
import { ENGINE_VERSION } from "./evaluate";
import { fromMakeMeAHanzi } from "./reference";
import type { InkStroke, ReferenceCharacter } from "./types";
import { pilotPlan, sampleKey, TEST_PARTICIPANT_PREFIX } from "./pilot";
import {
  computeMetrics,
  SAMPLE_CATEGORIES,
  scoreSample,
  shouldAccept,
  sizeBucket,
  type SampleCategory,
} from "./validation";

export const sampleInputSchema = z.object({
  participantCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,16}$/, "Use a short code such as P07 (no names or emails)"),
  hanzi: z.string().trim().min(1).max(2),
  category: z.enum(SAMPLE_CATEGORIES),
  writtenHanzi: z.string().trim().max(2).optional().nullable(),
  style: z.string().trim().max(40).optional().nullable(),
  inputDevice: z.enum(["finger", "stylus", "mouse", "trackpad"]),
  canvasSizePx: z.number().int().min(80).max(4000).optional(),
  /** Coarse device facts only (no full user agent): limits fingerprinting. */
  deviceInfo: z
    .object({
      screen: z.string().max(20),
      pixelRatio: z.number().min(0.5).max(6),
      pointer: z.enum(["coarse", "fine", "unknown"]),
      browser: z.string().max(20),
      os: z.string().max(20),
    })
    .optional(),
  strokes: z.array(inkStrokeSchema).min(1).max(40),
  notes: z.string().trim().max(500).optional().nullable(),
  consentConfirmed: z.literal(true, "Confirm the participant consented before recording."),
});

/** Every character with stroke data, as identity candidates (the widest set we support). */
export async function loadAllReferences(prisma: PrismaClient): Promise<ReferenceCharacter[]> {
  const rows = await prisma.character.findMany({
    where: { hasStrokeData: true },
    select: { hanzi: true, strokes: { orderBy: { strokeIndex: "asc" }, select: { median: true } } },
  });
  return rows.map((r) =>
    fromMakeMeAHanzi(
      r.hanzi,
      r.strokes.map((s) => s.median as number[][]),
    ),
  );
}

export async function recordSample(prisma: PrismaClient, actor: Actor, raw: unknown) {
  const input = sampleInputSchema.parse(raw);
  const character = await prisma.character.findUnique({ where: { hanzi: input.hanzi } });
  if (!character || !character.hasStrokeData)
    throw new DomainError("not_found", "That character has no reference stroke data.");
  if (input.category === "WRONG_CHARACTER" && !input.writtenHanzi)
    throw new DomainError("conflict", "Say which character was written instead.");
  const candidates = await loadAllReferences(prisma);
  const expected = candidates.find((c) => c.hanzi === input.hanzi)!;
  const strokes = input.strokes as InkStroke[];
  const { evaluation, accepted, detected } = scoreSample(
    { category: input.category, strokes },
    expected,
    candidates,
  );
  const sample = await prisma.$transaction(async (tx) => {
    const created = await tx.handwritingSample.create({
      data: {
        collectorId: actor.id,
        participantCode: input.participantCode.toUpperCase(),
        characterId: character.id,
        category: input.category,
        shouldAccept: shouldAccept(input.category),
        writtenHanzi: input.writtenHanzi ?? null,
        style: input.style ?? null,
        inputDevice: input.inputDevice,
        canvasSizePx: input.canvasSizePx ?? null,
        deviceInfo: input.deviceInfo ?? undefined,
        strokes: input.strokes,
        engineVersion: ENGINE_VERSION,
        band: evaluation.band,
        score: evaluation.score,
        identityVerified: evaluation.identity.verified,
        notes: input.notes ?? null,
        consentConfirmed: true,
      },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "handwriting.sample.record",
      entityType: "HandwritingSample",
      entityId: created.id,
      after: { category: input.category, hanzi: input.hanzi, participant: created.participantCode },
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return created;
  });
  return { sampleId: sample.id, evaluation, accepted, detected };
}

/**
 * Re-scores stored samples with the current engine and computes the metrics. Samples from
 * automated tests (participant codes starting with TEST) are excluded unless asked for.
 */
export async function analyseSamples(
  prisma: PrismaClient,
  limit = 20_000,
  { includeTests = false }: { includeTests?: boolean } = {},
) {
  const [samples, candidates] = await Promise.all([
    prisma.handwritingSample.findMany({
      where: includeTests
        ? {}
        : { NOT: { participantCode: { startsWith: TEST_PARTICIPANT_PREFIX } } },
      take: limit,
      orderBy: { createdAt: "asc" },
      include: { character: { select: { hanzi: true } } },
    }),
    loadAllReferences(prisma),
  ]);
  const byHanzi = new Map(candidates.map((c) => [c.hanzi, c]));
  const scored = samples.flatMap((s) => {
    const expected = byHanzi.get(s.character.hanzi);
    if (!expected) return [];
    const strokes = s.strokes as unknown as InkStroke[];
    const category = s.category as SampleCategory;
    const r = scoreSample({ category, strokes }, expected, candidates);
    return [
      {
        id: s.id,
        hanzi: s.character.hanzi,
        category,
        accepted: r.accepted,
        detected: r.detected,
        band: r.evaluation.band,
        participant: s.participantCode,
        inputDevice: s.inputDevice,
        sizeBucket: sizeBucket(strokes),
      },
    ];
  });
  return { samples: scored, metrics: computeMetrics(scored) };
}

/** Pilot progress for one participant: which plan prompts are recorded, and what's next. */
export async function pilotProgress(prisma: PrismaClient, participantCode: string) {
  const code = participantCode.toUpperCase();
  const plan = pilotPlan(code);
  const rows = await prisma.handwritingSample.findMany({
    where: { participantCode: code },
    select: { category: true, style: true, character: { select: { hanzi: true } } },
  });
  const done = new Set(
    rows.map((r) => sampleKey({ hanzi: r.character.hanzi, category: r.category, style: r.style })),
  );
  const remaining = plan.filter((p) => !done.has(p.key));
  return { plan, recorded: plan.length - remaining.length, next: remaining[0] ?? null };
}

/** Per-participant sample counts (human samples only). */
export async function participantSummary(prisma: PrismaClient) {
  const rows = await prisma.handwritingSample.groupBy({
    by: ["participantCode"],
    where: { NOT: { participantCode: { startsWith: TEST_PARTICIPANT_PREFIX } } },
    _count: true,
  });
  return rows.map((r) => ({ code: r.participantCode, samples: r._count }));
}
