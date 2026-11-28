import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/database/prisma";
import { apiError, handleApi, readJson } from "@/lib/api/respond";
import { rateLimitWrite, requireApiUser } from "@/lib/api/learner";
import { getLessonPractice } from "@/features/learning/lesson-data";
import { getLessonState } from "@/features/progression/lesson-states";
import { recordLessonDownload } from "@/features/offline/downloads";

const bodySchema = z.object({ deviceId: z.uuid() });

/**
 * POST /api/lessons/:id/download — returns an offline package for an unlocked lesson and
 * records which content version this device holds.
 */
export const POST = handleApi(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requireApiUser();
    const limited = await rateLimitWrite(user.id);
    if (limited) return limited;
    const { id } = await context.params;
    const { deviceId } = bodySchema.parse(await readJson(request, 4_000));

    const state = await getLessonState(prisma, user.id, id);
    if (!state) return apiError(404, "not_found", "Lesson not found.");
    if (state === "LOCKED")
      return apiError(403, "forbidden", "Complete the previous lesson first.");
    const [lesson, payload] = await Promise.all([
      prisma.lesson.findUniqueOrThrow({
        where: { id },
        select: { id: true, title: true, contentVersion: true },
      }),
      getLessonPractice(id),
    ]);
    if (!payload) return apiError(404, "not_found", "Lesson not found.");

    await recordLessonDownload(prisma, {
      userId: user.id,
      clientDeviceId: deviceId,
      lessonId: id,
      contentVersion: lesson.contentVersion,
    });

    return NextResponse.json({
      lessonId: lesson.id,
      title: lesson.title,
      contentVersion: lesson.contentVersion,
      payload,
    });
  },
);
