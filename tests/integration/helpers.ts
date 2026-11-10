import "dotenv/config";
import { createPrismaClient } from "@/lib/database/client";
import { ROLE_DEFINITIONS } from "@/lib/permissions/permissions";
import type { RoleKey } from "@/generated/prisma/enums";

export function testPrisma() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  return createPrismaClient(url);
}

export async function ensureRoles(prisma: ReturnType<typeof testPrisma>) {
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS) as [
    RoleKey,
    { name: string; description: string },
  ][]) {
    await prisma.role.upsert({ where: { key }, create: { key, ...def }, update: {} });
  }
}

let counter = 0;
export function uniqueEmail(prefix = "user") {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@hanziquest.test`;
}
