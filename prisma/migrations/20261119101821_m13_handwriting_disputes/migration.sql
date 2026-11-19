-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('CORRECT_MARKED_WRONG', 'WRONG_MARKED_CORRECT', 'TECHNIQUE_FEEDBACK_WRONG', 'INPUT_PROBLEM');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('GRADING_WRONG', 'GRADING_CORRECT', 'NOT_ASSESSABLE');

-- CreateTable
CREATE TABLE "HandwritingDispute" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "DisputeReason" NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'SUBMITTED',
    "outcome" "DisputeOutcome",
    "originalResult" "AttemptResult" NOT NULL,
    "engineVersion" TEXT,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "reviewerId" TEXT,
    "reviewerRole" TEXT,
    "claimedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandwritingDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HandwritingDispute_attemptId_key" ON "HandwritingDispute"("attemptId");

-- CreateIndex
CREATE INDEX "HandwritingDispute_status_createdAt_idx" ON "HandwritingDispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HandwritingDispute_userId_createdAt_idx" ON "HandwritingDispute"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HandwritingDispute_reviewerId_idx" ON "HandwritingDispute"("reviewerId");

-- AddForeignKey
ALTER TABLE "HandwritingDispute" ADD CONSTRAINT "HandwritingDispute_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExerciseAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandwritingDispute" ADD CONSTRAINT "HandwritingDispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandwritingDispute" ADD CONSTRAINT "HandwritingDispute_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
