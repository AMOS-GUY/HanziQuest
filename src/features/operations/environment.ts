/**
 * Deployment environment identity (M11, D-053, D-054).
 *
 * - `APP_ENV` names the deployment: "staging" or "production". Fatal if it's missing on
 *   Render (lib/env.ts).
 * - The database carries the same name in `DeploymentMarker`, written once when a new, empty
 *   database is first deployed. Readiness refuses to serve (503) when the two disagree, and the
 *   deploy workflow checks the marker before any backup or migration. So:
 *   - staging can't run against the production database, or the reverse;
 *   - a production backup restored into staging (it carries the "production" marker) is never
 *     served by staging.
 * - Local development and tests leave APP_ENV unset, and the check is skipped.
 */
import type { PrismaClient } from "@/generated/prisma/client";

export const DEPLOYMENT_ENVIRONMENTS = ["staging", "production"] as const;
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export function deploymentEnvironment(
  env: Record<string, string | undefined> = process.env,
): DeploymentEnvironment | null {
  const value = env.APP_ENV?.trim().toLowerCase();
  return (DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value ?? "")
    ? (value as DeploymentEnvironment)
    : null;
}

export type MarkerState = "ok" | "mismatch" | "unmarked" | "not-checked";

type Raw = Pick<PrismaClient, "$queryRaw">;

/** The database's marker, or null if there is none (or the table doesn't exist yet). */
export async function readMarker(prisma: Raw): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ environment: string }[]>`
      SELECT environment FROM "DeploymentMarker" WHERE id = 1`;
    return rows[0]?.environment ?? null;
  } catch {
    return null;
  }
}

export async function markerState(
  prisma: Raw,
  expected: DeploymentEnvironment | null,
): Promise<MarkerState> {
  if (!expected) return "not-checked";
  const marker = await readMarker(prisma);
  if (marker === null) return "unmarked";
  return marker === expected ? "ok" : "mismatch";
}

/** True when the database holds no accounts (a new database, safe to mark). */
export async function isEmptyDatabase(prisma: Raw): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "User"`;
    return (rows[0]?.n ?? 0) === 0;
  } catch {
    // No User table: nothing has been migrated yet.
    return true;
  }
}

export type GuardResult =
  | { ok: true; state: "ok" | "new" }
  | { ok: false; reason: "mismatch" | "unmarked-with-data"; marker: string | null };

/**
 * The deploy workflow's check, run BEFORE backup and migrations. A database is acceptable if it
 * carries the expected marker, or if it is unmarked and holds no accounts (a new database).
 */
export async function guardDatabase(
  prisma: Raw,
  expected: DeploymentEnvironment,
): Promise<GuardResult> {
  const marker = await readMarker(prisma);
  if (marker === expected) return { ok: true, state: "ok" };
  if (marker !== null) return { ok: false, reason: "mismatch", marker };
  if (await isEmptyDatabase(prisma)) return { ok: true, state: "new" };
  return { ok: false, reason: "unmarked-with-data", marker: null };
}

/** Writes the marker once. Never changes an existing marker. */
export async function markDatabase(
  prisma: Pick<PrismaClient, "$executeRaw" | "$queryRaw">,
  expected: DeploymentEnvironment,
): Promise<"marked" | "already"> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO "DeploymentMarker" (id, environment) VALUES (1, ${expected})
    ON CONFLICT (id) DO NOTHING`;
  if (inserted === 1) return "marked";
  const marker = await readMarker(prisma);
  if (marker !== expected)
    throw new Error(`The database is marked "${marker}", not "${expected}". Refusing.`);
  return "already";
}
