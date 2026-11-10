-- AlterTable
ALTER TABLE "ExerciseAttempt" ADD COLUMN     "localDate" DATE;

-- CreateTable
CREATE TABLE "AttemptCharacterResult" (
    "attemptId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "mode" "PracticeMode" NOT NULL,
    "result" "AttemptResult" NOT NULL,
    "score" DOUBLE PRECISION,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttemptCharacterResult_pkey" PRIMARY KEY ("attemptId","position")
);

-- CreateIndex
CREATE INDEX "AttemptCharacterResult_userId_characterId_occurredAt_idx" ON "AttemptCharacterResult"("userId", "characterId", "occurredAt");

-- CreateIndex
CREATE INDEX "ExerciseAttempt_userId_exerciseId_localDate_idx" ON "ExerciseAttempt"("userId", "exerciseId", "localDate");

-- AddForeignKey
ALTER TABLE "AttemptCharacterResult" ADD CONSTRAINT "AttemptCharacterResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExerciseAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptCharacterResult" ADD CONSTRAINT "AttemptCharacterResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptCharacterResult" ADD CONSTRAINT "AttemptCharacterResult_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill per-character results for existing single-character attempts. Word attempts made
-- before this migration have no per-character rows; they still count in the attempt history.
INSERT INTO "AttemptCharacterResult" ("attemptId", "position", "userId", "characterId", "mode", "result", "score", "occurredAt")
SELECT "id", 0, "userId", "characterId", "mode", "result", "score", "occurredAt"
FROM "ExerciseAttempt"
WHERE "characterId" IS NOT NULL;
