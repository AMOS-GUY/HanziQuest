/**
 * Seeds reference data. Safe to run repeatedly (everything is upserted).
 *  - roles
 *  - basic achievement definitions
 *  - the HSK 1 starter curriculum (content/hsk1-starter.json)
 *  - an initial SUPER_ADMIN when SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are set
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import type { Prisma } from "../src/generated/prisma/client";
import type { RoleKey } from "../src/generated/prisma/enums";
import { createPrismaClient } from "../src/lib/database/client";
import { ROLE_DEFINITIONS } from "../src/lib/permissions/permissions";
import { loadStrokeData } from "../src/features/curriculum/stroke-data";
import { validateCurriculumContent } from "../src/features/curriculum/validate-content";
import { importCurriculumContent } from "../src/features/curriculum/import-content";
import { BCRYPT_COST } from "../src/lib/auth/password";

const prisma = createPrismaClient();

const ACHIEVEMENTS: {
  key: string;
  name: string;
  description: string;
  icon: string;
  criteria: Prisma.InputJsonValue;
  xpReward: number;
}[] = [
  {
    key: "first-character",
    name: "First stroke",
    description: "Write your first character correctly.",
    icon: "pen-line",
    criteria: { type: "characters_written", count: 1 },
    xpReward: 10,
  },
  {
    key: "first-lesson",
    name: "Lesson one",
    description: "Complete your first lesson.",
    icon: "book-open-check",
    criteria: { type: "lessons_completed", count: 1 },
    xpReward: 20,
  },
  {
    key: "ten-characters",
    name: "Ten characters",
    description: "Learn ten different characters.",
    icon: "sparkles",
    criteria: { type: "characters_learned", count: 10 },
    xpReward: 30,
  },
  {
    key: "streak-3",
    name: "Three-day streak",
    description: "Practise three days in a row.",
    icon: "flame",
    criteria: { type: "streak", days: 3 },
    xpReward: 20,
  },
  {
    key: "streak-7",
    name: "One-week streak",
    description: "Practise seven days in a row.",
    icon: "flame",
    criteria: { type: "streak", days: 7 },
    xpReward: 50,
  },
];

async function seedRoles() {
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS) as [
    RoleKey,
    (typeof ROLE_DEFINITIONS)[RoleKey],
  ][]) {
    await prisma.role.upsert({
      where: { key },
      create: { key, name: def.name, description: def.description },
      update: { name: def.name, description: def.description },
    });
  }
  console.log(`Roles: ${Object.keys(ROLE_DEFINITIONS).length}`);
}

async function seedAchievements() {
  for (const a of ACHIEVEMENTS) {
    await prisma.achievement.upsert({ where: { key: a.key }, create: a, update: a });
  }
  console.log(`Achievements: ${ACHIEVEMENTS.length}`);
}

async function seedCurriculum() {
  const file = path.resolve("content/hsk1-starter.json");
  const result = validateCurriculumContent(
    JSON.parse(fs.readFileSync(file, "utf8")),
    loadStrokeData,
  );
  if (!result.ok || !result.content) {
    for (const issue of result.issues) console.error(issue);
    throw new Error("Starter curriculum failed validation");
  }
  const summary = await importCurriculumContent(prisma, result.content, {
    publishNewLessons: true,
    lookupStrokes: loadStrokeData,
  });
  console.log("Curriculum:", summary);
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("Admin: skipped (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set)");
    return;
  }
  if (password.length < 12) throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters");

  const roles = await prisma.role.findMany({ where: { key: { in: ["SUPER_ADMIN", "LEARNER"] } } });
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: "Administrator",
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      profile: { create: { displayName: "Administrator" } },
    },
    update: {},
  });
  for (const role of roles) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  await prisma.auditLog.create({
    data: { action: "seed.admin.ensure", entityType: "User", entityId: user.id, after: { email } },
  });
  console.log(`Admin: ${email} has SUPER_ADMIN`);
}

async function main() {
  await seedRoles();
  await seedAchievements();
  await seedCurriculum();
  await seedAdmin();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
