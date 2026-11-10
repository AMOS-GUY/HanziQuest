"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudOff, RefreshCcw } from "lucide-react";
import { getDb, setMeta } from "@/features/offline/client/db";
import { flushOutbox } from "@/features/offline/client/sync";

const RETRY_MS = 60_000;

/** Registers the service worker (production only). */
function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/**
 * Keeps the offline outbox moving: uploads queued practice when the app opens, when the
 * connection returns and periodically while anything is waiting. Shows a small status pill.
 */
export function SyncManager({ userId }: { userId: string }) {
  useServiceWorker();
  const online = useOnline();
  const counts = useLiveQuery(async () => {
    const db = getDb();
    if (!db) return { pending: 0, rejected: 0 };
    const rows = await db.outbox.where("userId").equals(userId).toArray();
    return {
      pending: rows.filter((r) => r.status === "pending").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
    };
  }, [userId]);
  const pending = counts?.pending ?? 0;

  useEffect(() => {
    void setMeta("lastUserId", userId);
  }, [userId]);

  useEffect(() => {
    if (!online || pending === 0) return;
    void flushOutbox(userId);
    const timer = window.setInterval(() => void flushOutbox(userId), RETRY_MS);
    return () => window.clearInterval(timer);
  }, [online, pending, userId]);

  if (online && pending === 0 && !counts?.rejected) return null;
  return (
    <div
      role="status"
      className="bg-surface border-border fixed top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-50 flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs font-bold shadow-sm"
    >
      {!online ? (
        <>
          <CloudOff className="size-4" aria-hidden />
          Offline{pending > 0 ? ` · ${pending} saved on this device` : ""}
        </>
      ) : pending > 0 ? (
        <>
          <RefreshCcw className="size-4 motion-safe:animate-spin" aria-hidden />
          Syncing {pending}…
        </>
      ) : (
        <>{counts?.rejected} item(s) couldn&apos;t be synced</>
      )}
    </div>
  );
}
