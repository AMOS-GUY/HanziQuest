/**
 * getNextAchievement: what Home shows as "Next achievement". Read-only: it reports which active
 * achievement the learner hasn't earned yet; awarding stays with the achievement rules.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser } from "@/features/authentication/register";
import { getNextAchievement } from "@/features/progress/queries";
import { ensureRoles, testPrisma, uniqueEmail } from "./helpers";

const prisma = testPrisma();
const tag = randomUUID().slice(0, 8);
let low = "";
let high = "";
let inactive = "";

beforeAll(async () => {
  await ensureRoles(prisma);
  // Rewards below any seeded achievement, so these three come first for this test's learners.
  const make = (key: string, xpReward: number, active = true) =>
    prisma.achievement.create({
      data: {
        key: `${key}-${tag}`,
        name: `${key} ${tag}`,
        description: `Test achievement ${key}`,
        icon: "trophy",
        criteria: { type: "test" },
        xpReward,
        active,
      },
    });
  inactive = (await make("inactive", -30, false)).id;
  low = (await make("low", -20)).id;
  high = (await make("high", -10)).id;
});

afterAll(async () => {
  await prisma.userAchievement.deleteMany({
    where: { achievementId: { in: [low, high, inactive] } },
  });
  await prisma.achievement.deleteMany({ where: { id: { in: [low, high, inactive] } } });
  await prisma.$disconnect();
});

async function learner() {
  const r = await registerUser(prisma, {
    displayName: "Achiever",
    email: uniqueEmail("next-ach"),
    password: "password-1234",
  });
  if (!r.ok) throw new Error("setup");
  return r.userId;
}

describe("getNextAchievement", () => {
  it("is the smallest-reward active achievement not yet earned; inactive ones never show", async () => {
    const user = await learner();
    expect((await getNextAchievement(prisma, user))?.key).toBe(`low-${tag}`);

    await prisma.userAchievement.create({ data: { userId: user, achievementId: low } });
    expect((await getNextAchievement(prisma, user))?.key).toBe(`high-${tag}`);
  });

  it("only looks at this learner's achievements", async () => {
    const a = await learner();
    const b = await learner();
    await prisma.userAchievement.create({ data: { userId: a, achievementId: low } });
    expect((await getNextAchievement(prisma, b))?.key).toBe(`low-${tag}`);
  });

  it("is null once every active achievement is earned", async () => {
    const user = await learner();
    const all = await prisma.achievement.findMany({ where: { active: true } });
    await prisma.userAchievement.createMany({
      data: all.map((a) => ({ userId: user, achievementId: a.id })),
    });
    expect(await getNextAchievement(prisma, user)).toBeNull();
  });

  it("never writes anything", async () => {
    const user = await learner();
    const before = await prisma.userAchievement.count({ where: { userId: user } });
    await getNextAchievement(prisma, user);
    expect(await prisma.userAchievement.count({ where: { userId: user } })).toBe(before);
  });
});
