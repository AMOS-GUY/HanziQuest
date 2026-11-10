"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudOff, PenLine } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getDb, getMeta } from "@/features/offline/client/db";
import { SyncManager } from "./sync-manager";

/** Offline landing page: downloaded lessons and what's waiting to sync. */
export function OfflineHome() {
  const [userId, setUserId] = useState<string | null>();
  useEffect(() => {
    void getMeta("lastUserId").then(setUserId);
  }, []);
  const data = useLiveQuery(async () => {
    const db = getDb();
    if (!db || !userId) return { packages: [], pending: 0 };
    const [packages, pending] = await Promise.all([
      db.packages.where("userId").equals(userId).toArray(),
      db.outbox.where("userId").equals(userId).count(),
    ]);
    return { packages, pending };
  }, [userId]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 py-8">
      {userId ? <SyncManager userId={userId} /> : null}
      <div className="flex items-center gap-3">
        <Logo size={40} />
        <h1 className="text-2xl font-black">Offline practice</h1>
      </div>
      <Card className="flex items-start gap-3">
        <CloudOff className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden />
        <CardDescription>
          You can practise lessons you downloaded. Your answers are checked on this device and saved
          here, then checked again by the server and added to your progress when you&apos;re back
          online.
        </CardDescription>
      </Card>

      {data && data.pending > 0 ? (
        <p className="text-sm font-bold">
          {data.pending} item{data.pending === 1 ? "" : "s"} waiting to sync.
        </p>
      ) : null}

      <section aria-labelledby="downloaded">
        <h2 id="downloaded" className="mb-3 text-lg font-extrabold">
          Downloaded lessons
        </h2>
        {!data ? null : data.packages.length === 0 ? (
          <Card>
            <CardTitle className="text-base">No lessons downloaded</CardTitle>
            <CardDescription>
              When you&apos;re online, open a lesson and choose “Download for offline”.
            </CardDescription>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.packages.map((p) => (
              <li key={p.lessonId}>
                <Card className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-bold">{p.title}</p>
                    <p className="text-muted-foreground text-sm">
                      {p.payload.exercises.length} exercises
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={`/offline/practice?lesson=${encodeURIComponent(p.lessonId)}`}>
                      <PenLine aria-hidden /> Practise
                    </Link>
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Button asChild variant="ghost">
        <Link href="/home">Try the full app</Link>
      </Button>
    </div>
  );
}
