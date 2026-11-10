import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { handleApi } from "@/lib/api/respond";
import { rateLimitWrite, requireApiUser } from "@/lib/api/learner";
import { startLessonSession } from "@/features/learning/sessions";

const bodySchema = z.object({ lessonId: z.string().min(1).max(64) });

/** POST /api/sessions — start a lesson session. */
export const POST = handleApi(async (request: Request) => {
  const user = await requireApiUser();
  const limited = rateLimitWrite(user.id);
  if (limited) return limited;
  const { lessonId } = bodySchema.parse(await request.json());
  const session = await startLessonSession(prisma, user.id, lessonId);
  return NextResponse.json(
    { sessionId: session.id, startedAt: session.startedAt },
    { status: 201 },
  );
});
