"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CircleCheck, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDb } from "@/features/offline/client/db";
import { downloadLesson, removeLesson } from "@/features/offline/client/sync";

/** Download / update / remove a lesson for offline practice. */
export function OfflineDownload({
  userId,
  lessonId,
  contentVersion,
}: {
  userId: string;
  lessonId: string;
  contentVersion: number;
}) {
  const stored = useLiveQuery(async () => {
    const pkg = await getDb()?.packages.get(lessonId);
    return pkg && pkg.userId === userId ? pkg : null;
  }, [lessonId, userId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const download = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await downloadLesson(userId, lessonId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  if (stored === undefined) return null;
  const outdated = stored && stored.contentVersion !== contentVersion;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {stored && !outdated ? (
        <>
          <span className="text-primary flex items-center gap-1 font-bold">
            <CircleCheck className="size-4" aria-hidden /> Available offline
          </span>
          <Button variant="ghost" size="sm" onClick={() => void removeLesson(lessonId)}>
            Remove download
          </Button>
        </>
      ) : (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void download()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
          {outdated ? "Update offline copy" : "Download for offline"}
        </Button>
      )}
      {error ? (
        <span role="alert" className="text-danger font-bold">
          {error}
        </span>
      ) : null}
    </div>
  );
}
