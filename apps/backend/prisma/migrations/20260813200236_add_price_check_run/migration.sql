-- CreateTable
CREATE TABLE "PriceCheckRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "checked" INTEGER NOT NULL,
    "changed" INTEGER NOT NULL,
    "errorsCount" INTEGER NOT NULL,
    "changes" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "escalations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceCheckRun_startedAt_idx" ON "PriceCheckRun"("startedAt");
