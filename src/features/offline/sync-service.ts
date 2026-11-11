/**
 * Offline sync inbox. Devices upload queued events; each event id is a client UUID, so uploading
 * the same batch twice is harmless. Events are applied in the order given. All evaluation, XP and
 * progress is recomputed on the server exactly as for online submissions.
 */
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DomainError } from "@/features/administration/services";
import { submitAttempt } from "@/features/exercises/attempts";
import { completeLessonSession, startLessonSession } from "@/features/learning/sessions";

export const MAX_SYNC_EVENTS = 25;

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.uuid(),
    type: z.literal("attempt"),
    clientCreatedAt: z.iso.datetime(),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    id: z.uuid(),
    type: z.literal("lesson.complete"),
    clientCreatedAt: z.iso.datetime(),
    payload: z.object({
      lessonId: z.string().min(1).max(64),
      sessionId: z.string().min(1).max(64).nullish(),
      attemptIds: z.array(z.uuid()).max(200),
    }),
  }),
]);

export const syncBatchSchema = z.object({
  deviceId: z.uuid(),
  events: z.array(eventSchema).max(MAX_SYNC_EVENTS),
});

export type SyncBatch = z.infer<typeof syncBatchSchema>;
type SyncEventInput = SyncBatch["events"][number];

export interface SyncEventResult {
  id: string;
  status: "processed" | "duplicate" | "rejected";
  error?: string;
  result?: unknown;
}

function describe(error: unknown): string | null {
  if (error instanceof DomainError) return error.message;
  if (error instanceof z.ZodError) return "The queued data is invalid.";
  return null;
}

async function ensureDevice(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  userAgent: string | null,
) {
  return prisma.device.upsert({
    where: { userId_clientId: { userId, clientId } },
    create: { userId, clientId, userAgent },
    update: { lastSeenAt: new Date(), userAgent },
  });
}

async function apply(
  prisma: PrismaClient,
  userId: string,
  deviceId: string,
  event: SyncEventInput,
  now: Date,
): Promise<unknown> {
  if (event.type === "attempt") {
    const outcome = await submitAttempt(
      prisma,
      userId,
      { ...event.payload, clientEventId: event.id },
      { now, deviceId },
    );
    return { result: outcome.result, xpAwarded: outcome.xpAwarded };
  }
  // A lesson finished offline: attach its session-less attempts to a session, then complete it.
  const { lessonId, attemptIds } = event.payload;
  let sessionId = event.payload.sessionId ?? null;
  if (sessionId) {
    const s = await prisma.learningSession.findUnique({ where: { id: sessionId } });
    if (!s || s.userId !== userId || s.lessonId !== lessonId) sessionId = null;
  }
  sessionId ??= (await startLessonSession(prisma, userId, lessonId)).id;
  await prisma.exerciseAttempt.updateMany({
    where: { userId, clientEventId: { in: attemptIds }, sessionId: null },
    data: { sessionId },
  });
  const done = await completeLessonSession(prisma, userId, sessionId);
  return { nextLessonId: done.nextLessonId, xpAwarded: done.progress?.xpAwarded ?? 0 };
}

export async function processSyncBatch(
  prisma: PrismaClient,
  userId: string,
  raw: unknown,
  meta: { userAgent?: string | null; now?: Date } = {},
): Promise<{ results: SyncEventResult[] }> {
  const batch = syncBatchSchema.parse(raw);
  const now = meta.now ?? new Date();
  const device = await ensureDevice(prisma, userId, batch.deviceId, meta.userAgent ?? null);
  const results: SyncEventResult[] = [];

  for (const event of batch.events) {
    const existing = await prisma.syncEvent.findUnique({ where: { id: event.id } });
    if (existing && existing.userId !== userId) {
      results.push({ id: event.id, status: "rejected", error: "Event id already in use." });
      continue;
    }
    if (existing?.status === "PROCESSED" || existing?.status === "DUPLICATE") {
      results.push({ id: event.id, status: "duplicate" });
      continue;
    }
    if (existing?.status === "REJECTED") {
      results.push({ id: event.id, status: "rejected", error: existing.error ?? undefined });
      continue;
    }
    if (!existing) {
      // skipDuplicates: two uploads of the same queue (two tabs, or a retry racing a slow
      // request) must not fail the whole batch. Applying the event is idempotent anyway.
      const { count } = await prisma.syncEvent.createMany({
        data: {
          id: event.id,
          userId,
          deviceId: device.id,
          type: event.type,
          payload: event.payload as Prisma.InputJsonValue,
          clientCreatedAt: new Date(event.clientCreatedAt),
        },
        skipDuplicates: true,
      });
      if (count === 0) {
        const winner = await prisma.syncEvent.findUnique({ where: { id: event.id } });
        if (winner && winner.userId !== userId) {
          results.push({ id: event.id, status: "rejected", error: "Event id already in use." });
          continue;
        }
      }
    }
    try {
      const result = await apply(prisma, userId, device.id, event, now);
      await prisma.syncEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processedAt: new Date(), error: null },
      });
      results.push({ id: event.id, status: "processed", result });
    } catch (error) {
      const message = describe(error);
      // Unexpected failures stay RECEIVED so the next upload retries them.
      if (message === null) throw error;
      await prisma.syncEvent.update({
        where: { id: event.id },
        data: { status: "REJECTED", processedAt: new Date(), error: message },
      });
      results.push({ id: event.id, status: "rejected", error: message });
    }
  }
  return { results };
}
