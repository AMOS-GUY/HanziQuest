-- CreateTable
CREATE TABLE "DeploymentMarker" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentMarker_pkey" PRIMARY KEY ("id")
);
