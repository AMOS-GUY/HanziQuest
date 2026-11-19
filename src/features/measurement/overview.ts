/**
 * Prepared replacement for the admin overview's 7-day learner figures (M15-b, not wired yet:
 * D-079). Today the overview counts every account, staff and test accounts included, and shows
 * a pass rate however few learners it describes; with one active learner that is one person's
 * performance. This version:
 * - counts measured learners only (`population.ts`);
 * - shows the figures only when at least k learners were active, so a single learner's volume
 *   or results never appear;
 * - suppresses the pass rate when fewer than k learners wrote independently, or one learner made
 *   more than half of the attempts;
 * - reads through `readOnlyClient`.
 * Operational figures that aren't about learners (offline events rejected, pilot samples) stay
 * on the page as they are.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { readOnlyClient } from "@/lib/database/read-only";
import { DEFAULT_MIN_GROUP, publicRate, type PublicRate } from "./analytics";
import { MEASURED_LEARNER } from "./population";
import { proportion } from "./stats";

const DAY_MS = 86_400_000;

export type OverviewCount =
  { shown: true; value: number } | { shown: false; reason: "small-group" };

export interface OverviewActivity {
  activeLearners: OverviewCount;
  newLearners: OverviewCount;
  attempts: OverviewCount;
  lessonsCompleted: OverviewCount;
  independentPassRate: PublicRate;
}

export async function overviewActivity(
  prisma: PrismaClient,
  options: { now?: Date; k?: number } = {},
): Promise<OverviewActivity> {
  const k = options.k ?? DEFAULT_MIN_GROUP;
  const since = new Date((options.now ?? new Date()).getTime() - 7 * DAY_MS);
  const db = readOnlyClient(prisma);
  const measured = { occurredAt: { gte: since }, user: MEASURED_LEARNER };
  const [active, writers, completions, newLearners] = await Promise.all([
    db.exerciseAttempt.groupBy({ by: ["userId"], where: measured, _count: { _all: true } }),
    db.exerciseAttempt.groupBy({
      by: ["userId"],
      where: { ...measured, mode: "INDEPENDENT", result: { not: "SKIPPED" } },
      _count: { _all: true },
    }),
    db.lessonProgress.count({
      where: { status: "COMPLETED", completedAt: { gte: since }, user: MEASURED_LEARNER },
    }),
    db.user.count({ where: { ...MEASURED_LEARNER, createdAt: { gte: since } } }),
  ]);
  const passed = await db.exerciseAttempt.count({
    where: { ...measured, mode: "INDEPENDENT", result: { in: ["EXCELLENT", "GOOD"] } },
  });

  const enough = active.length >= k;
  const count = (value: number): OverviewCount =>
    enough ? { shown: true, value } : { shown: false, reason: "small-group" };
  const independent = writers.reduce((s, w) => s + w._count._all, 0);
  const largest = writers.reduce((m, w) => Math.max(m, w._count._all), 0);
  return {
    activeLearners: count(active.length),
    // New sign-ups are shown with the others, and like them only when enough learners were active.
    newLearners: count(newLearners),
    attempts: count(active.reduce((s, a) => s + a._count._all, 0)),
    lessonsCompleted: count(completions),
    independentPassRate: enough
      ? publicRate(proportion(passed, independent, writers.length, largest), k, true)
      : { shown: false, reason: "small-group" },
  };
}
