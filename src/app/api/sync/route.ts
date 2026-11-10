import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { handleApi } from "@/lib/api/respond";
import { rateLimitWrite, requireApiUser } from "@/lib/api/learner";
import { processSyncBatch } from "@/features/offline/sync-service";

/** POST /api/sync — upload queued offline events (idempotent per event id). */
export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser();
  const limited = rateLimitWrite(user.id);
  if (limited) return limited;
  const body: unknown = await request.json();
  const outcome = await processSyncBatch(prisma, user.id, body, {
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
  });
  return NextResponse.json(outcome);
});
