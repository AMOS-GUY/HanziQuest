import { NextResponse } from "next/server";
import { prisma } from "@/lib/database/prisma";
import { handleApi } from "@/lib/api/respond";
import { rateLimitWrite, requireApiUser } from "@/lib/api/learner";
import { completeLessonSession } from "@/features/learning/sessions";

/** POST /api/sessions/:id/complete — mark the lesson complete when every exercise was attempted. */
export const POST = handleApi(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    const limited = await rateLimitWrite(user.id);
    if (limited) return limited;
    const { id } = await context.params;
    const result = await completeLessonSession(prisma, user.id, id);
    return NextResponse.json({ completed: true, ...result });
  },
);
