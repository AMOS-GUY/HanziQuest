import { NextResponse } from "next/server";
import { releaseId } from "@/lib/release";
import { deploymentEnvironment } from "@/features/operations/environment";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/live — liveness for container health checks (M10-01). The process is up and
 * serving requests. It deliberately doesn't query the database: an outage there must not make
 * the platform restart healthy instances. Readiness is /api/health.
 */
export function GET() {
  return NextResponse.json(
    { status: "ok", release: releaseId(), environment: deploymentEnvironment() ?? "development" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
