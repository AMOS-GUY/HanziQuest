import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/** Creates a Prisma client using the node-postgres driver adapter. Usable from scripts and tests. */
export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
