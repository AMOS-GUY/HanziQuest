-- CreateEnum
CREATE TYPE "PilotParticipantStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'RETENTION_ENDED');

-- CreateEnum
CREATE TYPE "HandwritingObservation" AS ENUM ('HESITATED', 'RESTARTED', 'USED_UNDO', 'UNSURE_OF_CHARACTER', 'INSTRUCTION_MISUNDERSTOOD', 'DIFFERENT_ERROR_THAN_ASKED', 'WROTE_OUTSIDE_BOX', 'DEVICE_LAG_OR_PALM_TOUCH', 'INTERRUPTED');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "hsk20Level" INTEGER,
ADD COLUMN     "hsk30Handwriting" BOOLEAN,
ADD COLUMN     "hsk30Level" INTEGER,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewerRole" TEXT,
ADD COLUMN     "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Curriculum" ADD COLUMN     "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "HandwritingSample" ADD COLUMN     "consentId" TEXT,
ADD COLUMN     "observations" "HandwritingObservation"[] DEFAULT ARRAY[]::"HandwritingObservation"[],
ADD COLUMN     "participantId" TEXT;

-- AlterTable
ALTER TABLE "Vocabulary" ADD COLUMN     "exampleSourceRef" TEXT,
ADD COLUMN     "exampleVerification" "VerificationStatus",
ADD COLUMN     "hsk20Level" INTEGER,
ADD COLUMN     "hsk30Level" INTEGER,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewerRole" TEXT,
ADD COLUMN     "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "PilotParticipant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PilotParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "erasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotConsent" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilotParticipant_code_key" ON "PilotParticipant"("code");

-- CreateIndex
CREATE INDEX "PilotParticipant_status_idx" ON "PilotParticipant"("status");

-- CreateIndex
CREATE INDEX "PilotConsent_participantId_idx" ON "PilotConsent"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "PilotConsent_participantId_version_key" ON "PilotConsent"("participantId", "version");

-- CreateIndex
CREATE INDEX "HandwritingSample_participantId_idx" ON "HandwritingSample"("participantId");

-- CreateIndex
CREATE INDEX "HandwritingSample_consentId_idx" ON "HandwritingSample"("consentId");

-- AddForeignKey
ALTER TABLE "HandwritingSample" ADD CONSTRAINT "HandwritingSample_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "PilotParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandwritingSample" ADD CONSTRAINT "HandwritingSample_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "PilotConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotParticipant" ADD CONSTRAINT "PilotParticipant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotConsent" ADD CONSTRAINT "PilotConsent_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "PilotParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotConsent" ADD CONSTRAINT "PilotConsent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
