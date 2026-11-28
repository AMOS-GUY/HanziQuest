import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Records that a learner's device downloaded a lesson for offline practice. The caller (the
 * download route) has already checked the lesson is visible and not locked.
 *
 * `firstDownloadedAt` is set when the row is created and never updated: re-downloads move only
 * `downloadedAt` and `contentVersion`. Offline attempts may not predate the first download
 * (D-085), so a re-download can never widen that window. The row is per learner and device, so
 * another learner, or another device, never shares it.
 */
export async function recordLessonDownload(
  prisma: PrismaClient,
  input: { userId: string; clientDeviceId: string; lessonId: string; contentVersion: number },
  now: Date = new Date(),
) {
  const { userId, clientDeviceId, lessonId, contentVersion } = input;
  const device = await prisma.device.upsert({
    where: { userId_clientId: { userId, clientId: clientDeviceId } },
    create: { userId, clientId: clientDeviceId },
    update: { lastSeenAt: now },
  });
  return prisma.downloadedContentVersion.upsert({
    where: { deviceId_lessonId: { deviceId: device.id, lessonId } },
    create: {
      userId,
      deviceId: device.id,
      lessonId,
      contentVersion,
      downloadedAt: now,
      firstDownloadedAt: now,
    },
    // Never `firstDownloadedAt` here.
    update: { contentVersion, downloadedAt: now },
  });
}
