/**
 * Liveness and readiness (M10-01, M10-02).
 *
 * - Liveness (`/api/health/live`): the process is up and serving. It never touches the
 *   database, so a short database outage doesn't make the platform restart healthy containers.
 * - Readiness (`/api/health`): the database answers, no migration is unfinished or failed, and
 *   every migration shipped with this build is applied. New code must not take traffic on an
 *   old schema. A database that is *ahead* of the code (after a rollback) is fine, because
 *   migrations are additive (expand, then contract).
 *
 * Responses reveal no configuration, connection details or personal data.
 */
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { markerState, type DeploymentEnvironment, type MarkerState } from "./environment";

export type MigrationState = "ok" | "incomplete" | "pending" | "unknown";

export interface Readiness {
  ok: boolean;
  database: "ok" | "unavailable";
  migrations: MigrationState;
  pendingMigrations?: number;
  /** Whether the database belongs to this deployment (M11, D-054). */
  databaseEnvironment?: MarkerState;
}

let cached: string[] | null | undefined;

/** Migration folder names shipped with this build, or null if the folder isn't present. */
export function expectedMigrations(
  // Resolved at run time from the app root (the image copies prisma/); not a build input.
  dir = path.join(/* turbopackIgnore: true */ process.cwd(), "prisma", "migrations"),
) {
  if (cached !== undefined) return cached;
  try {
    cached = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    cached = null;
  }
  return cached;
}

export async function checkReadiness(
  prisma: Pick<PrismaClient, "$queryRaw">,
  expected: readonly string[] | null,
  environment: DeploymentEnvironment | null = null,
): Promise<Readiness> {
  const base = await checkSchema(prisma, expected);
  if (!environment || base.database !== "ok") return base;
  // A staging app must never serve a production database, or the reverse.
  const databaseEnvironment = await markerState(prisma, environment);
  return { ...base, ok: base.ok && databaseEnvironment === "ok", databaseEnvironment };
}

async function checkSchema(
  prisma: Pick<PrismaClient, "$queryRaw">,
  expected: readonly string[] | null,
): Promise<Readiness> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return { ok: false, database: "unavailable", migrations: "unknown" };
  }
  let rows: { migration_name: string; unfinished: boolean }[];
  try {
    rows = await prisma.$queryRaw`
      SELECT migration_name, (finished_at IS NULL) AS unfinished
      FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`;
  } catch {
    // No migrations table: the schema was never migrated.
    return { ok: false, database: "ok", migrations: "unknown" };
  }
  if (rows.some((r) => r.unfinished))
    return { ok: false, database: "ok", migrations: "incomplete" };
  if (!expected) return { ok: true, database: "ok", migrations: "unknown" };
  const applied = new Set(rows.map((r) => r.migration_name));
  const pending = expected.filter((name) => !applied.has(name)).length;
  if (pending > 0)
    return { ok: false, database: "ok", migrations: "pending", pendingMigrations: pending };
  return { ok: true, database: "ok", migrations: "ok" };
}
