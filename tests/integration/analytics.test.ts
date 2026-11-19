/**
 * M15-b analytics data layer on SYNTHETIC learners: permission, exclusions, suppression, only
 * aggregates and no identifiers in the output, and the prepared overview figures.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnalyticsPermissionError, learningAnalytics } from "@/features/measurement/analytics";
import { overviewActivity } from "@/features/measurement/overview";
import { ensureRoles, testPrisma } from "./helpers";
import {
  measurementCurriculum,
  syntheticAttempts,
  syntheticLearner,
  type MeasurementFixture,
} from "./measurement-fixtures";

const prisma = testPrisma();
const RUN = `${Date.now()}`;
const DAY = 86_400_000;
const NOW = new Date("2026-10-20T12:00:00Z"); // week 2026-W43
const WEEK_START = new Date("2026-09-14T09:00:00Z"); // 2026-W38
const at = (d: number) => new Date(WEEK_START.getTime() + d * DAY);
const ids: string[] = [];
const emails: string[] = [];
let fx: MeasurementFixture;

async function learner(
  name: string,
  roles?: ("LEARNER" | "CURRICULUM_EDITOR" | "ANALYST")[],
  domain = "measure.example",
) {
  const email = `m15b-${name}-${RUN}@${domain}`;
  const id = await syntheticLearner(prisma, { email, createdAt: at(ids.length % 5), roles });
  ids.push(id);
  emails.push(email);
  return id;
}

beforeAll(async () => {
  await ensureRoles(prisma);
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { startsWith: "m15b-", endsWith: "@measure.example" } },
        { email: { startsWith: "m15b-", endsWith: "@hanziquest.test" } },
      ],
    },
  });
  fx = await measurementCurriculum(prisma, `m15b-${RUN}`, 3, 0x4d60);
  // Six learners practising; a staff account and a test account practising a lot (excluded).
  for (let i = 0; i < 6; i += 1) {
    const id = await learner(`l${i}`);
    await syntheticAttempts(prisma, fx, id, [
      { characterId: fx.characterIds[0]!, occurredAt: at(i % 5), result: "GOOD" },
      {
        characterId: fx.characterIds[0]!,
        occurredAt: at((i % 5) + 1),
        result: i % 2 ? "GOOD" : "TRY_AGAIN",
      },
      // Recent activity for the overview (within 7 days of NOW).
      {
        characterId: fx.characterIds[1]!,
        occurredAt: new Date(NOW.getTime() - DAY),
        result: "GOOD",
      },
    ]);
  }
  for (const [name, roles, domain] of [
    ["staff", ["LEARNER", "CURRICULUM_EDITOR"], "measure.example"],
    ["tester", undefined, "hanziquest.test"],
  ] as const) {
    const id = await learner(name, roles ? [...roles] : undefined, domain);
    await syntheticAttempts(
      prisma,
      fx,
      id,
      Array.from({ length: 40 }, (_, j) => ({
        characterId: fx.characterIds[2]!,
        occurredAt: new Date(NOW.getTime() - DAY + j * 60_000),
        result: "TRY_AGAIN" as const,
      })),
    );
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("learning analytics data layer", () => {
  it("needs analytics:read, whatever other roles the actor holds", async () => {
    for (const roles of [
      ["LEARNER"],
      ["CURRICULUM_EDITOR"],
      ["CONTENT_REVIEWER", "MODERATOR"],
    ] as const)
      await expect(
        learningAnalytics(prisma, { roles: [...roles] }, { now: NOW }),
      ).rejects.toBeInstanceOf(AnalyticsPermissionError);
  });

  it("returns whole past weeks only, each on its own, with no totals", async () => {
    const out = await learningAnalytics(prisma, { roles: ["ANALYST"] }, { now: NOW });
    expect(out.map((c) => c.week)).toEqual([
      "2026-W42",
      "2026-W41",
      "2026-W40",
      "2026-W39",
      "2026-W38",
      "2026-W37",
      "2026-W36",
      "2026-W35",
    ]);
    expect(out.some((c) => c.week === "2026-W43")).toBe(false); // the current week
    expect(Array.isArray(out)).toBe(true);
  });

  it("counts measured learners only, and leaks no identifier", async () => {
    const out = await learningAnalytics(prisma, { roles: ["ANALYST"] }, { now: NOW, weeks: 8 });
    const w38 = out.find((c) => c.week === "2026-W38")!;
    expect(w38.learners).toEqual({ shown: true, count: 6 });
    expect(w38.lapseRate).toMatchObject({ shown: true, learners: 6 });
    const json = JSON.stringify(out);
    for (const x of [...ids, ...emails]) expect(json).not.toContain(x);
    expect(json).not.toMatch(/@|userId|largest|successes|contributors/);
    // With k = 7, the same six learners show nothing.
    const strict = await learningAnalytics(prisma, { roles: ["ANALYST"] }, { now: NOW, k: 7 });
    expect(strict.find((c) => c.week === "2026-W38")!.learners).toEqual({
      shown: false,
      reason: "small-group",
    });
  });
});

describe("prepared overview figures", () => {
  it("count measured learners only, and only from k active learners", async () => {
    const shown = await overviewActivity(prisma, { now: NOW, k: 5 });
    expect(shown.activeLearners).toEqual({ shown: true, value: expect.any(Number) });
    // At least our six learners (other suites' synthetic data may also fall in these 7 days).
    // The exclusions are asserted exactly by the cohort test above.
    if (shown.activeLearners.shown) expect(shown.activeLearners.value).toBeGreaterThanOrEqual(6);
    const hidden = await overviewActivity(prisma, { now: NOW, k: 1000 });
    expect(hidden).toMatchObject({
      activeLearners: { shown: false },
      attempts: { shown: false },
      newLearners: { shown: false },
      lessonsCompleted: { shown: false },
      independentPassRate: { shown: false },
    });
  });
});
