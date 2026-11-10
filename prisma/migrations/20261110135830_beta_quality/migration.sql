-- CreateEnum
CREATE TYPE "HandwritingSampleCategory" AS ENUM ('CORRECT', 'WRONG_CHARACTER', 'MISSING_STROKE', 'EXTRA_STROKE', 'WRONG_DIRECTION', 'WRONG_ORDER', 'POOR_SHAPE');

-- CreateTable
CREATE TABLE "HandwritingSample" (
    "id" TEXT NOT NULL,
    "collectorId" TEXT,
    "participantCode" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "category" "HandwritingSampleCategory" NOT NULL,
    "shouldAccept" BOOLEAN NOT NULL,
    "writtenHanzi" TEXT,
    "style" TEXT,
    "inputDevice" TEXT,
    "canvasSizePx" INTEGER,
    "strokes" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "identityVerified" BOOLEAN NOT NULL,
    "notes" TEXT,
    "consentConfirmed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandwritingSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "HandwritingSample_category_idx" ON "HandwritingSample"("category");

-- CreateIndex
CREATE INDEX "HandwritingSample_participantCode_idx" ON "HandwritingSample"("participantCode");

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- AddForeignKey
ALTER TABLE "HandwritingSample" ADD CONSTRAINT "HandwritingSample_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandwritingSample" ADD CONSTRAINT "HandwritingSample_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
