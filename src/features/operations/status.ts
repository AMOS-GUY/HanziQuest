/**
 * Operational status for staff (M9): what needs attention during the beta. Read-only.
 * Shows names and counts only: no configuration values, no personal data.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { checkEnvironment, type EnvIssue } from "@/lib/env";
import { registrationMode, type RegistrationMode } from "@/features/invites/invites";

export interface OperationsStatus {
  generatedAt: string;
  release: string;
  database: { latencyMs: number };
  migrations: {
    applied: number;
    latest: string | null;
    latestAt: string | null;
    incomplete: number;
  };
  configuration: EnvIssue[];
  registration: { mode: RegistrationMode; activeInvites: number; signupsLast7Days: number };
  sync: {
    /** Received more than 15 minutes ago and still not processed: a client keeps failing. */
    stuck: number;
    rejectedLast24h: number;
    topRejections: { error: string; count: number }[];
  };
  feedback: { new: number; oldestNewAt: string | null; last7Days: number };
  learners: { total: number; activeLast7Days: number };
  handwritingPilot: { samples: number; participants: number };
  auditLog: { entries: number; oldestAt: string | null };
}

const DAY = 86_400_000;

export async function operationsStatus(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<OperationsStatus> {
  const started = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const latencyMs = Date.now() - started;
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const dayAgo = new Date(now.getTime() - DAY);

  const [migrationRows, incompleteRows] = await Promise.all([
    prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at DESC`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
  ]);

  const [
    activeInvites,
    signups,
    stuck,
    rejected,
    rejections,
    feedbackNew,
    oldestNew,
    feedbackWeek,
    learners,
    activeLearners,
    samples,
    participants,
    auditCount,
    oldestAudit,
  ] = await Promise.all([
    prisma.betaInvite.count({
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.syncEvent.count({
      where: { status: "RECEIVED", receivedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    }),
    prisma.syncEvent.count({ where: { status: "REJECTED", receivedAt: { gte: dayAgo } } }),
    prisma.syncEvent.groupBy({
      by: ["error"],
      where: { status: "REJECTED", receivedAt: { gte: weekAgo } },
      _count: { _all: true },
      orderBy: { _count: { error: "desc" } },
      take: 5,
    }),
    prisma.feedback.count({ where: { status: "NEW" } }),
    prisma.feedback.findFirst({
      where: { status: "NEW" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.feedback.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.user.count({ where: { roles: { some: { role: { key: "LEARNER" } } } } }),
    prisma.dailyActivity.groupBy({ by: ["userId"], where: { date: { gte: weekAgo } } }),
    prisma.handwritingSample.count({ where: { NOT: { participantCode: { startsWith: "TEST" } } } }),
    prisma.handwritingSample.groupBy({
      by: ["participantCode"],
      where: { NOT: { participantCode: { startsWith: "TEST" } } },
    }),
    prisma.auditLog.count(),
    prisma.auditLog.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  return {
    generatedAt: now.toISOString(),
    release: process.env.APP_RELEASE ?? "dev",
    database: { latencyMs },
    migrations: {
      applied: migrationRows.length,
      latest: migrationRows[0]?.migration_name ?? null,
      latestAt: migrationRows[0]?.finished_at?.toISOString() ?? null,
      incomplete: Number(incompleteRows[0]?.count ?? 0),
    },
    configuration: checkEnvironment(),
    registration: { mode: registrationMode(), activeInvites, signupsLast7Days: signups },
    sync: {
      stuck,
      rejectedLast24h: rejected,
      topRejections: rejections.map((r) => ({
        error: r.error ?? "(no message)",
        count: r._count._all,
      })),
    },
    feedback: {
      new: feedbackNew,
      oldestNewAt: oldestNew?.createdAt.toISOString() ?? null,
      last7Days: feedbackWeek,
    },
    learners: { total: learners, activeLast7Days: activeLearners.length },
    handwritingPilot: { samples, participants: participants.length },
    auditLog: { entries: auditCount, oldestAt: oldestAudit?.createdAt.toISOString() ?? null },
  };
}
