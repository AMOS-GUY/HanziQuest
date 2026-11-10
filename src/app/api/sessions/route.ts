import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { handleApi, readJson } from "@/lib/api/respond";
import { rateLimitWrite, requireApiUser } from "@/lib/api/learner";
import { startLessonSession, startReviewSession } from "@/features/learning/sessions";

const bodySchema = z.union([
  z.object({ lessonId: z.string().min(1).max(64) }),
  z.object({ type: z.literal("REVIEW") }),
]);

/** POST /api/sessions — start a lesson session ({ lessonId }) or a review session ({ type: "REVIEW" }). */
export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser();
  const limited = await rateLimitWrite(user.id);
  if (limited) return limited;
  const body = bodySchema.parse(await readJson(request, 4_000));
  const session =
    "lessonId" in body
      ? await startLessonSession(prisma, user.id, body.lessonId)
      : (await startReviewSession(prisma, user.id)).session;
  return NextResponse.json(
    { sessionId: session.id, startedAt: session.startedAt },
    { status: 201 },
  );
});
