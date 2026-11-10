"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Button } from "@/components/ui/button";
import { PracticeRunner } from "@/components/lessons/practice-runner";
import { getDb } from "@/features/offline/client/db";
import { getActiveAccount } from "@/features/offline/client/account";
import { SyncManager } from "./sync-manager";

/** Runs a downloaded lesson from IndexedDB. */
export function OfflinePractice() {
  const lessonId = useSearchParams().get("lesson") ?? "";
  // Only the active account's downloads are usable; another account's are never shown.
  const pkg = useLiveQuery(async () => {
    const [owner, found] = await Promise.all([getActiveAccount(), getDb()?.packages.get(lessonId)]);
    return found && owner && found.userId === owner ? found : null;
  }, [lessonId]);

  if (pkg === undefined) return null;
  if (!pkg) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 py-10 text-center">
        <p>This lesson isn&apos;t downloaded on this device.</p>
        <Button asChild>
          <Link href="/offline">Back</Link>
        </Button>
      </div>
    );
  }
  return (
    <>
      <SyncManager userId={pkg.userId} />
      <PracticeRunner
        payload={pkg.payload}
        mode={{ kind: "lesson", lessonId: pkg.lessonId }}
        userId={pkg.userId}
        exitHref="/offline"
      />
    </>
  );
}
