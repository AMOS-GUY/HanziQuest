import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness and readiness for uptime monitors and load balancers.
 * - database: can we query it?
 * - migrations: has any migration failed or not finished? (A deploy must not serve traffic on a
 *   half-migrated database.)
 * Reveals no configuration or personal data.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "unavailable" = "ok";
  let migrations: "ok" | "incomplete" | "unknown" = "unknown";
  try {
    await prisma.$queryRaw`SELECT 1`;
    try {
      const rows = await prisma.$queryRaw<{ count: bigint | number }[]>`
        SELECT count(*) AS count FROM "_prisma_migrations"
        WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
      migrations = Number(rows[0]?.count ?? 0) === 0 ? "ok" : "incomplete";
    } catch {
      migrations = "unknown";
    }
  } catch {
    database = "unavailable";
  }
  const ok = database === "ok" && migrations !== "incomplete";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      database,
      migrations,
      release: process.env.APP_RELEASE ?? "dev",
      latencyMs: Date.now() - started,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
