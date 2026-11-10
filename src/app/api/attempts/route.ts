import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { handleApi } from "@/lib/api/respond";
import { rateLimitWrite, requireApiUser } from "@/lib/api/learner";
import { submitAttempt } from "@/features/exercises/attempts";

/** POST /api/attempts — record an exercise attempt (idempotent by clientEventId). */
export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser();
  const limited = rateLimitWrite(user.id);
  if (limited) return limited;
  const body: unknown = await request.json();
  const outcome = await submitAttempt(prisma, user.id, body);
  return NextResponse.json(outcome, { status: outcome.duplicate ? 200 : 201 });
});
