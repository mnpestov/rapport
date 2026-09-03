-- AlterTable
ALTER TABLE "PriceCheckRun" ADD COLUMN     "alertsDispatchedAt" TIMESTAMP(3);

-- Бэкофилл: все исторические прогоны уже «обработаны». Без этого первый
-- запуск джоба priceAlertDispatcher разослал бы уведомления по всей истории.
UPDATE "PriceCheckRun" SET "alertsDispatchedAt" = "createdAt"
WHERE "alertsDispatchedAt" IS NULL;

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceAlert_patternId_idx" ON "PriceAlert"("patternId");

-- CreateIndex
CREATE INDEX "PriceAlert_userId_idx" ON "PriceAlert"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceAlert_userId_patternId_key" ON "PriceAlert"("userId", "patternId");

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "Pattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
