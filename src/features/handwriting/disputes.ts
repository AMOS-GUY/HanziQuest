/**
 * Handwriting disputes (M13, D-081): "I think this was marked wrong".
 *
 * - A learner disputes one of their own saved handwriting attempts, with a structured reason
 *   and explicit consent that a reviewer may look at the writing. No free text, from learners
 *   or reviewers.
 * - Ownership: the attempt is looked up by its client event id AND the signed-in learner, so
 *   another learner's attempt simply doesn't exist (404, no IDOR).
 * - One dispute per attempt (unique), within 14 days of the attempt reaching the server.
 * - Nothing here changes grading, XP, mastery, schedules or the attempt. A finding is evidence for
 *   M13 validation, never a correction. The original result is also snapshotted on the dispute.
 * - Reviewers need `handwriting:review-disputes`, can't review their own disputes, and see no
 *   learner identifiers. Every transition is a single conditional update (so concurrent claims
 *   or double submissions can't both succeed) and is audited without ink or identifiers.
 * - Disputes are deleted with the learner's account (cascade); audit entries remain, with the
 *   actor cleared, as for every other audit entry.
 */
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type {
  AttemptResult,
  DisputeOutcome,
  DisputeReason,
  DisputeStatus,
  RoleKey,
} from "@/generated/prisma/enums";
import { recordAudit } from "@/lib/audit";
import { ADMIN_ROLES, hasPermission } from "@/lib/permissions/permissions";
import { DomainError } from "@/features/administration/services";
import type { InkStroke } from "./types";
import { DISPUTE_OUTCOMES, DISPUTE_REASONS } from "./dispute-reasons";

export { DISPUTE_OUTCOMES, DISPUTE_REASONS };

export const DISPUTE_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

export const disputeInputSchema = z.strictObject({
  clientEventId: z.uuid(),
  reason: z.enum(DISPUTE_REASONS.map((r) => r.key) as [DisputeReason, ...DisputeReason[]]),
  consent: z.literal(true, "Please agree that a reviewer may look at this writing."),
});

export interface DisputeActor {
  id: string;
  roles: readonly RoleKey[];
  ip?: string | null;
  userAgent?: string | null;
}

const unique = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Submits a learner's dispute. Never changes the attempt or any progress. */
export async function submitDispute(
  prisma: PrismaClient,
  learner: { id: string; ip?: string | null; userAgent?: string | null },
  raw: unknown,
  options: { now?: Date } = {},
) {
  const input = disputeInputSchema.parse(raw);
  const now = options.now ?? new Date();
  // Own handwriting attempts only (ink stored): anything else is "not found", whoever owns it.
  const attempt = await prisma.exerciseAttempt.findFirst({
    where: {
      clientEventId: input.clientEventId,
      userId: learner.id,
      strokeData: { not: Prisma.AnyNull },
    },
    select: { id: true, result: true, receivedAt: true, evaluation: true },
  });
  if (!attempt)
    throw new DomainError(
      "not_found",
      "We couldn't find this saved attempt. If it was saved on this device only, try again once it has synced.",
    );
  if (attempt.receivedAt.getTime() < now.getTime() - DISPUTE_WINDOW_DAYS * DAY_MS)
    throw new DomainError(
      "conflict",
      `Results can be disputed for ${DISPUTE_WINDOW_DAYS} days after they're saved.`,
    );
  const reason = DISPUTE_REASONS.find((r) => r.key === input.reason)!;
  if (!reason.eligible(attempt.result))
    throw new DomainError("conflict", "That reason doesn't match this result.");
  const evaluation = attempt.evaluation as { engineVersion?: unknown } | null;
  try {
    return await prisma.$transaction(async (tx) => {
      const dispute = await tx.handwritingDispute.create({
        data: {
          attemptId: attempt.id,
          userId: learner.id,
          reason: input.reason,
          originalResult: attempt.result,
          engineVersion:
            typeof evaluation?.engineVersion === "string" ? evaluation.engineVersion : null,
          consentedAt: now,
        },
        select: { id: true, status: true, reason: true, createdAt: true },
      });
      await recordAudit(tx, {
        actorId: learner.id,
        action: "handwriting.dispute.submit",
        entityType: "HandwritingDispute",
        entityId: dispute.id,
        after: { reason: input.reason, originalResult: attempt.result },
        ipAddress: learner.ip,
        userAgent: learner.userAgent,
      });
      return dispute;
    });
  } catch (e) {
    if (unique(e)) throw new DomainError("conflict", "You've already disputed this result.");
    throw e;
  }
}

/** A learner's own disputes, newest first (what they need to follow up, nothing more). */
export async function learnerDisputes(prisma: PrismaClient, userId: string) {
  const rows = await prisma.handwritingDispute.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      reason: true,
      status: true,
      outcome: true,
      attempt: { select: { character: { select: { hanzi: true } } } },
    },
  });
  return rows.map(({ attempt, ...d }) => ({ ...d, hanzi: attempt.character?.hanzi ?? null }));
}

// ─── Reviewing ──────────────────────────────────────────────────────────────

function assertReviewer(actor: DisputeActor) {
  if (!hasPermission(actor.roles, "handwriting:review-disputes"))
    throw new DomainError("forbidden", "Only handwriting reviewers can review disputes.");
}

/** The role recorded on a decision: the first one that grants dispute review. */
function reviewerRoleOf(roles: readonly RoleKey[]) {
  return (
    ADMIN_ROLES.find(
      (r) => roles.includes(r) && hasPermission([r], "handwriting:review-disputes"),
    ) ?? "UNKNOWN"
  );
}

export interface DisputeQueueItem {
  id: string;
  createdAt: Date;
  reason: DisputeReason;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  originalResult: AttemptResult;
  engineVersion: string | null;
  /** Expected characters, in order. */
  characters: string[];
  /** What the engine reported per character: band, best match and named findings. */
  evaluation: { band: string; bestMatch: string | null; findings: string[] }[];
  ink: InkStroke[][];
  /** The viewer submitted this dispute: they can't review it. */
  ownDispute: boolean;
  claimedByViewer: boolean;
  claimedByOther: boolean;
  /** Claimed, but the reviewer is gone or idle for STALE_CLAIM_DAYS: anyone may take it over. */
  claimStale: boolean;
}

/**
 * The review queue. Returns no learner identifiers: reviewers judge the writing, not the person.
 */
export async function disputeQueue(
  prisma: PrismaClient,
  actor: DisputeActor,
  options: { status?: DisputeStatus | "OPEN"; take?: number } = {},
): Promise<DisputeQueueItem[]> {
  assertReviewer(actor);
  const status = options.status ?? "OPEN";
  const rows = await prisma.handwritingDispute.findMany({
    where: status === "OPEN" ? { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } : { status },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(options.take ?? 20, 1), 50),
    select: {
      id: true,
      createdAt: true,
      reason: true,
      status: true,
      outcome: true,
      originalResult: true,
      engineVersion: true,
      userId: true,
      reviewerId: true,
      claimedAt: true,
      attempt: { select: { strokeData: true, evaluation: true } },
    },
  });
  return rows.map((d) => {
    const evaluation = (d.attempt.evaluation ?? {}) as {
      characters?: {
        hanzi?: string;
        band?: string;
        identity?: { bestMatch?: string | null };
        feedback?: { code?: string }[];
      }[];
    };
    const chars = evaluation.characters ?? [];
    return {
      id: d.id,
      createdAt: d.createdAt,
      reason: d.reason,
      status: d.status,
      outcome: d.outcome,
      originalResult: d.originalResult,
      engineVersion: d.engineVersion,
      characters: chars.map((c) => c.hanzi ?? "?"),
      evaluation: chars.map((c) => ({
        band: c.band ?? "?",
        bestMatch: c.identity?.bestMatch ?? null,
        findings: (c.feedback ?? []).flatMap((f) => (f.code ? [f.code] : [])),
      })),
      ink: (d.attempt.strokeData ?? []) as unknown as InkStroke[][],
      ownDispute: d.userId === actor.id,
      claimedByViewer: d.reviewerId === actor.id,
      claimedByOther: !!d.reviewerId && d.reviewerId !== actor.id,
      claimStale:
        d.status === "UNDER_REVIEW" &&
        d.reviewerId !== actor.id &&
        (!d.reviewerId ||
          (!!d.claimedAt && d.claimedAt.getTime() < Date.now() - STALE_CLAIM_DAYS * DAY_MS)),
    };
  });
}

async function explainRefusal(
  prisma: PrismaClient,
  actor: DisputeActor,
  id: string,
): Promise<never> {
  const d = await prisma.handwritingDispute.findUnique({
    where: { id },
    select: { userId: true, status: true, reviewerId: true },
  });
  if (!d) throw new DomainError("not_found", "Dispute not found.");
  if (d.userId === actor.id)
    throw new DomainError(
      "forbidden",
      "You submitted this dispute, so another reviewer has to review it.",
    );
  if (d.status === "RESOLVED" || d.status === "DISMISSED")
    throw new DomainError("conflict", "This dispute has already been decided.");
  if (d.reviewerId && d.reviewerId !== actor.id)
    throw new DomainError("conflict", "Another reviewer is reviewing this dispute.");
  throw new DomainError("conflict", "This dispute isn't in a state for that.");
}

async function transition(
  prisma: PrismaClient,
  actor: DisputeActor,
  id: string,
  action: string,
  where: Prisma.HandwritingDisputeWhereInput,
  data: Prisma.HandwritingDisputeUncheckedUpdateManyInput,
  after: Record<string, unknown>,
) {
  assertReviewer(actor);
  const done = await prisma.$transaction(async (tx) => {
    // Never on one's own dispute, whatever else the condition says.
    const changed = await tx.handwritingDispute.updateMany({
      where: { id, userId: { not: actor.id }, ...where },
      data,
    });
    if (changed.count === 0) return false;
    await recordAudit(tx, {
      actorId: actor.id,
      action,
      entityType: "HandwritingDispute",
      entityId: id,
      after: after as Prisma.InputJsonValue,
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
    });
    return true;
  });
  if (!done) await explainRefusal(prisma, actor, id);
}

/** A claim nobody has acted on for this long can be taken over by another reviewer. */
export const STALE_CLAIM_DAYS = 7;

export async function claimDispute(
  prisma: PrismaClient,
  actor: DisputeActor,
  id: string,
  options: { now?: Date } = {},
) {
  const now = options.now ?? new Date();
  await transition(
    prisma,
    actor,
    id,
    "handwriting.dispute.claim",
    {
      OR: [
        { status: "SUBMITTED" },
        // A claim can't be left stuck: its reviewer's account was deleted (reviewer cleared),
        // or nothing happened for STALE_CLAIM_DAYS (for example, they lost the permission).
        { status: "UNDER_REVIEW", reviewerId: null },
        {
          status: "UNDER_REVIEW",
          claimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_DAYS * DAY_MS) },
          reviewerId: { not: actor.id },
        },
      ],
    },
    {
      status: "UNDER_REVIEW",
      reviewerId: actor.id,
      reviewerRole: reviewerRoleOf(actor.roles),
      claimedAt: now,
    },
    { status: "UNDER_REVIEW" },
  );
}

export async function releaseDispute(prisma: PrismaClient, actor: DisputeActor, id: string) {
  await transition(
    prisma,
    actor,
    id,
    "handwriting.dispute.release",
    { status: "UNDER_REVIEW", reviewerId: actor.id },
    { status: "SUBMITTED", reviewerId: null, reviewerRole: null, claimedAt: null },
    { status: "SUBMITTED" },
  );
}

export const decisionSchema = z.strictObject({
  outcome: z.enum(DISPUTE_OUTCOMES.map((o) => o.key) as [DisputeOutcome, ...DisputeOutcome[]]),
});

/** Records the reviewer's finding. Only the claiming reviewer; never changes grading. */
export async function decideDispute(
  prisma: PrismaClient,
  actor: DisputeActor,
  id: string,
  raw: unknown,
) {
  const { outcome } = decisionSchema.parse(raw);
  const status = DISPUTE_OUTCOMES.find((o) => o.key === outcome)!.status;
  await transition(
    prisma,
    actor,
    id,
    "handwriting.dispute.decide",
    { status: "UNDER_REVIEW", reviewerId: actor.id },
    { status, outcome, decidedAt: new Date() },
    { status, outcome },
  );
}

/** Counts for the review page header (aggregates only). */
export async function disputeCounts(prisma: PrismaClient, actor: DisputeActor) {
  assertReviewer(actor);
  const rows = await prisma.handwritingDispute.groupBy({ by: ["status"], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<
    Record<DisputeStatus, number>
  >;
}
