-- CreateTable
CREATE TABLE "ErasureLedgerGate" (
    "id" TEXT NOT NULL,
    "restoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "backupName" TEXT,
    "ledgerAppliedAt" TIMESTAMP(3),
    "ledgerSha256" TEXT,
    "ledgerEntries" INTEGER,
    "clearedWithoutLedger" BOOLEAN NOT NULL DEFAULT false,
    "clearanceReason" TEXT,

    CONSTRAINT "ErasureLedgerGate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErasureLedgerGate_ledgerAppliedAt_idx" ON "ErasureLedgerGate"("ledgerAppliedAt");
