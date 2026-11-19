import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { apiError, handleApi, readJson } from "@/lib/api/respond";
import { requireApiUser } from "@/lib/api/learner";
import { disputeLimiter } from "@/lib/security/rate-limit";
import { getRequestInfo } from "@/lib/security/request-info";
import { submitDispute } from "@/features/handwriting/disputes";

/**
 * POST /api/disputes: dispute one of your own handwriting results (M13, D-081).
 * Body: { clientEventId, reason, consent: true }. Changes no grade or progress.
 */
export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser();
  const limit = await disputeLimiter.consume(user.id);
  if (!limit.allowed) {
    const response = apiError(429, "rate_limited", "Too many disputes today. Try again tomorrow.");
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }
  const body: unknown = await readJson(request, 2_000);
  const { ip, userAgent } = await getRequestInfo();
  const dispute = await submitDispute(prisma, { id: user.id, ip, userAgent }, body);
  return NextResponse.json({ id: dispute.id, status: dispute.status }, { status: 201 });
});
