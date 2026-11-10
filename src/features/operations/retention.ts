/**
 * Retention of operational data (M9). The periods are the owner's decision (LEGAL_REVIEW.md),
 * so nothing is pruned unless a period is given, and the default is a dry run.
 *
 * - Audit log entries older than `auditDays` (they contain IP addresses and user agents).
 * - Processed offline sync events older than `syncDays` (their payloads duplicate attempts,
 *   which are kept; rejected and unprocessed events are kept for investigation).
 * - Expired rate-limit buckets (always safe).
 * An applied prune writes its own audit entry with the counts.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";

export interface RetentionOptions {
  auditDays?: number;
  syncDays?: number;
  apply: boolean;
  now?: Date;
}

export const MIN_AUDIT_DAYS = 30;
export const MIN_SYNC_DAYS = 7;

export async function pruneOperationalData(prisma: PrismaClient, options: RetentionOptions) {
  const now = options.now ?? new Date();
  if (options.auditDays !== undefined && options.auditDays < MIN_AUDIT_DAYS)
    throw new Error(`auditDays must be at least ${MIN_AUDIT_DAYS}`);
  if (options.syncDays !== undefined && options.syncDays < MIN_SYNC_DAYS)
    throw new Error(`syncDays must be at least ${MIN_SYNC_DAYS}`);
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000);

  const auditWhere =
    options.auditDays !== undefined ? { createdAt: { lt: before(options.auditDays) } } : null;
  const syncWhere =
    options.syncDays !== undefined
      ? {
          status: { in: ["PROCESSED" as const, "DUPLICATE" as const] },
          receivedAt: { lt: before(options.syncDays) },
        }
      : null;
  const bucketWhere = { resetAt: { lt: now } };

  const counts = {
    auditLog: auditWhere ? await prisma.auditLog.count({ where: auditWhere }) : 0,
    syncEvents: syncWhere ? await prisma.syncEvent.count({ where: syncWhere }) : 0,
    rateLimitBuckets: await prisma.rateLimitBucket.count({ where: bucketWhere }),
  };
  if (!options.apply) return { applied: false, counts };

  await prisma.$transaction(async (tx) => {
    if (auditWhere) await tx.auditLog.deleteMany({ where: auditWhere });
    if (syncWhere) await tx.syncEvent.deleteMany({ where: syncWhere });
    await tx.rateLimitBucket.deleteMany({ where: bucketWhere });
    await recordAudit(tx, {
      actorId: null,
      action: "ops.prune",
      entityType: "System",
      after: {
        ...counts,
        auditDays: options.auditDays ?? null,
        syncDays: options.syncDays ?? null,
      },
    });
  });
  return { applied: true, counts };
}
