"use client";

import { getDb, getDeviceId, type LessonPackage, type OutboxEvent } from "./db";
import type { PracticePayload } from "@/features/exercises/dto";

const BATCH = 25;

export async function enqueue(
  userId: string,
  event: Pick<OutboxEvent, "id" | "type" | "payload">,
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  await db.outbox.put({
    ...event,
    userId,
    createdAt: new Date().toISOString(),
    status: "pending",
    tries: 0,
  });
  return true;
}

export interface FlushResult {
  sent: number;
  rejected: number;
  /** True when the upload stopped because the network or session is unavailable. */
  interrupted: boolean;
}

let running: Promise<FlushResult> | null = null;

/** Uploads this user's pending events in the order they were recorded. Safe to call often. */
export function flushOutbox(userId: string): Promise<FlushResult> {
  running ??= doFlush(userId).finally(() => {
    running = null;
  });
  return running;
}

async function doFlush(userId: string): Promise<FlushResult> {
  const db = getDb();
  const result: FlushResult = { sent: 0, rejected: 0, interrupted: false };
  if (!db) return result;
  const deviceId = await getDeviceId();
  for (;;) {
    const events = await db.outbox
      .where("userId")
      .equals(userId)
      .filter((e) => e.status === "pending")
      .sortBy("createdAt");
    if (events.length === 0) return result;
    const batch = events.slice(0, BATCH);
    let response: Response;
    try {
      response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          deviceId,
          events: batch.map((e) => ({
            id: e.id,
            type: e.type,
            clientCreatedAt: e.createdAt,
            payload: e.payload,
          })),
        }),
      });
    } catch {
      return { ...result, interrupted: true };
    }
    if (!response.ok) {
      // 401: signed out; 429/5xx: try later. Nothing is dropped.
      await db.outbox.bulkUpdate(
        batch.map((e) => ({ key: e.id, changes: { tries: e.tries + 1 } })),
      );
      return { ...result, interrupted: true };
    }
    const body = (await response.json()) as {
      results: { id: string; status: "processed" | "duplicate" | "rejected"; error?: string }[];
    };
    for (const r of body.results) {
      if (r.status === "rejected") {
        result.rejected += 1;
        await db.outbox.update(r.id, { status: "rejected", error: r.error ?? "Rejected" });
      } else {
        result.sent += 1;
        await db.outbox.delete(r.id);
      }
    }
    if (body.results.length === 0) return result;
  }
}

/** Downloads a lesson package for offline practice. */
export async function downloadLesson(userId: string, lessonId: string): Promise<LessonPackage> {
  const db = getDb();
  if (!db) throw new Error("Offline storage isn't available in this browser.");
  const deviceId = await getDeviceId();
  const response = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ deviceId }),
  });
  if (!response.ok) throw new Error("Couldn't download this lesson. Try again.");
  const body = (await response.json()) as {
    lessonId: string;
    title: string;
    contentVersion: number;
    payload: PracticePayload;
  };
  const pkg: LessonPackage = { ...body, userId, downloadedAt: new Date().toISOString() };
  await db.packages.put(pkg);
  return pkg;
}

export async function removeLesson(lessonId: string) {
  await getDb()?.packages.delete(lessonId);
}
