-- CreateEnum
CREATE TYPE "ReviewEntity" AS ENUM ('CURRICULUM', 'CHARACTER', 'VOCABULARY');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateTable
CREATE TABLE "ContentReview" (
    "id" TEXT NOT NULL,
    "entityType" "ReviewEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "level" "VerificationStatus",
    "reviewerId" TEXT,
    "reviewerRole" TEXT NOT NULL,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentReview_entityType_entityId_createdAt_idx" ON "ContentReview"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReview_decision_createdAt_idx" ON "ContentReview"("decision", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
