"use client";

/**
 * Account isolation for data stored in this browser (IndexedDB).
 *
 * - Downloaded lessons belong to the account that downloaded them. When a different account
 *   becomes active, or the owner signs out, they are deleted.
 * - Queued practice results stay with their owner. They are never shown to, or uploaded by,
 *   another account. They sync the next time the owner is signed in on this device, unless the
 *   owner chose to discard them when signing out.
 * - The "active account" marker is cleared on sign-out, so the offline pages show nothing
 *   until someone signs in again.
 */
import { getDb, getMeta, setMeta } from "./db";
import { flushOutbox } from "./sync";

const ACTIVE = "lastUserId";

/** Makes `userId` the active account and removes other accounts' downloads. */
export async function adoptAccount(userId: string) {
  const db = getDb();
  if (!db) return;
  const previous = await getMeta(ACTIVE);
  if (previous !== userId) await setMeta(ACTIVE, userId);
  await db.packages.where("userId").notEqual(userId).delete();
}

export async function getActiveAccount() {
  return getMeta(ACTIVE);
}

export async function pendingCount(userId: string) {
  const db = getDb();
  if (!db) return 0;
  return db.outbox
    .where("userId")
    .equals(userId)
    .filter((e) => e.status === "pending")
    .count();
}

/**
 * Prepares this browser for sign-out: uploads what it can (up to `timeoutMs`), deletes the
 * account's downloads and clears the active-account marker. With `discardPending`, unsynced
 * results are deleted too. Returns how many results were left waiting.
 */
export async function prepareSignOut(
  userId: string,
  { discardPending = false, timeoutMs = 4000 } = {},
): Promise<{ leftPending: number }> {
  const db = getDb();
  if (!db) return { leftPending: 0 };
  if (navigator.onLine) {
    await Promise.race([
      flushOutbox(userId).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
  await db.packages.where("userId").equals(userId).delete();
  // Rejected events have been seen by the server already; they hold no value after sign-out.
  await db.outbox
    .where("userId")
    .equals(userId)
    .filter((e) => discardPending || e.status === "rejected")
    .delete();
  if ((await getMeta(ACTIVE)) === userId) await db.meta.delete(ACTIVE);
  return { leftPending: await pendingCount(userId) };
}
