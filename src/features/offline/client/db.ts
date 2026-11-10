"use client";

import Dexie, { type EntityTable } from "dexie";
import type { PracticePayload } from "@/features/exercises/dto";

/** A learning event waiting to be uploaded. Owned by one user; never uploaded for another. */
export interface OutboxEvent {
  id: string;
  userId: string;
  type: "attempt" | "lesson.complete";
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "rejected";
  tries: number;
  error?: string;
}

/** A lesson downloaded for offline practice. */
export interface LessonPackage {
  lessonId: string;
  userId: string;
  title: string;
  contentVersion: number;
  downloadedAt: string;
  payload: PracticePayload;
}

export interface MetaRow {
  key: string;
  value: string;
}

class HanziQuestDb extends Dexie {
  outbox!: EntityTable<OutboxEvent, "id">;
  packages!: EntityTable<LessonPackage, "lessonId">;
  meta!: EntityTable<MetaRow, "key">;

  constructor() {
    super("hanziquest");
    this.version(1).stores({
      outbox: "id, userId, createdAt, status",
      packages: "lessonId, userId",
      meta: "key",
    });
  }
}

let instance: HanziQuestDb | null = null;

/** The local database, or null where IndexedDB is unavailable (SSR, some private modes). */
export function getDb(): HanziQuestDb | null {
  if (typeof indexedDB === "undefined") return null;
  instance ??= new HanziQuestDb();
  return instance;
}

export async function getMeta(key: string) {
  return (await getDb()?.meta.get(key))?.value ?? null;
}

export async function setMeta(key: string, value: string) {
  await getDb()?.meta.put({ key, value });
}

/** Stable random id for this browser profile. Contains no personal data. */
export async function getDeviceId(): Promise<string> {
  const existing = await getMeta("deviceId");
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setMeta("deviceId", id);
  return id;
}
