import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Connection pool settings (M10). Explicit so a small managed database (100 connections) or a
 * pooled URL (PgBouncer) isn't exhausted, and so a dead database fails fast instead of hanging.
 * Validated at start-up by `checkEnvironment` (DATABASE_POOL_MAX).
 */
export function poolSettings(env: Record<string, string | undefined> = process.env) {
  const max = Number.parseInt(env.DATABASE_POOL_MAX ?? "", 10);
  return {
    max: Number.isInteger(max) && max >= 1 && max <= 100 ? max : 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  };
}

/** Creates a Prisma client using the node-postgres driver adapter. Usable from scripts and tests. */
export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
  }
  const adapter = new PrismaPg({ connectionString, ...poolSettings() });
  return new PrismaClient({ adapter });
}
