-- M18 (D-085): progression integrity. Additive only (expand); no data is removed.
--  - ExerciseAttempt.countsForProgress: false for preview practice. Existing rows counted, so
--    they keep the default (true); history isn't rewritten.
--  - ExerciseAttempt.clientOccurredAt: the client's claimed time, diagnostic only. Null for rows
--    stored before M18 (their occurredAt was the client time).
--  - DownloadedContentVersion.firstDownloadedAt: the first download on a device, which
--    re-downloads never move. Offline attempts may not predate it.

-- AlterTable
ALTER TABLE "DownloadedContentVersion" ADD COLUMN     "firstDownloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: the true first download was at or before the latest recorded one, so this never
-- rejects an attempt made after the recorded download. Without it, rows would get the
-- migration time and queued offline attempts made before the deploy would be rejected.
UPDATE "DownloadedContentVersion" SET "firstDownloadedAt" = "downloadedAt";

-- AlterTable
ALTER TABLE "ExerciseAttempt" ADD COLUMN     "clientOccurredAt" TIMESTAMP(3),
ADD COLUMN     "countsForProgress" BOOLEAN NOT NULL DEFAULT true;
