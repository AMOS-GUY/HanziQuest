import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { checkReadiness, expectedMigrations } from "@/features/operations/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — readiness, for the platform's deploy health check and uptime monitors.
 * 200 only when the database answers and every migration in this build is applied
 * (features/operations/health.ts). Liveness without the database: /api/health/live.
 */
export async function GET() {
  const started = Date.now();
  const readiness = await checkReadiness(prisma, expectedMigrations());
  return NextResponse.json(
    {
      status: readiness.ok ? "ok" : "degraded",
      database: readiness.database,
      migrations: readiness.migrations,
      ...(readiness.pendingMigrations ? { pendingMigrations: readiness.pendingMigrations } : {}),
      release: process.env.APP_RELEASE ?? "dev",
      latencyMs: Date.now() - started,
    },
    { status: readiness.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
