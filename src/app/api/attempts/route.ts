import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { handleApi, readJson } from "@/lib/api/respond";
import { rateLimitWrite, requireApiUser } from "@/lib/api/learner";
import { submitAttempt } from "@/features/exercises/attempts";

/** POST /api/attempts — record an exercise attempt (idempotent by clientEventId). */
export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser();
  const limited = await rateLimitWrite(user.id);
  if (limited) return limited;
  const body: unknown = await readJson(request, 256_000);
  const outcome = await submitAttempt(prisma, user.id, body);
  return NextResponse.json(outcome, { status: outcome.duplicate ? 200 : 201 });
});
