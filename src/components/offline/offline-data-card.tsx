"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Button } from "@/components/ui/button";
import { getDb } from "@/features/offline/client/db";

/** What this device stores for the signed-in learner, with a way to remove downloads. */
export function OfflineDataCard({ userId }: { userId: string }) {
  const data = useLiveQuery(async () => {
    const db = getDb();
    if (!db) return null;
    const [packages, outbox] = await Promise.all([
      db.packages.where("userId").equals(userId).toArray(),
      db.outbox.where("userId").equals(userId).toArray(),
    ]);
    return {
      lessons: packages.map((p) => p.title),
      pending: outbox.filter((e) => e.status === "pending").length,
      rejected: outbox.filter((e) => e.status === "rejected").length,
    };
  }, [userId]);

  if (data === undefined) return null;
  if (data === null)
    return (
      <p className="text-muted-foreground text-sm">
        Offline storage isn&apos;t available in this browser.
      </p>
    );
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        {data.lessons.length === 0
          ? "No lessons downloaded on this device."
          : `Downloaded: ${data.lessons.join(", ")}.`}
      </p>
      <p>
        {data.pending === 0
          ? "Everything you practised here has synced."
          : `${data.pending} practice result${data.pending === 1 ? " is" : "s are"} waiting to sync.`}
        {data.rejected > 0
          ? ` ${data.rejected} couldn't be synced and will be cleared at sign-out.`
          : ""}
      </p>
      {data.lessons.length > 0 ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => void getDb()?.packages.where("userId").equals(userId).delete()}
        >
          Remove downloaded lessons
        </Button>
      ) : null}
    </div>
  );
}
