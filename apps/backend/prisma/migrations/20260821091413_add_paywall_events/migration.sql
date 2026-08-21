-- CreateEnum
CREATE TYPE "PaywallEventType" AS ENUM ('SHOWN', 'SCROLLED_TO_END', 'SUBSCRIBE_CLICK', 'CLOSED', 'BUTTON_OPENED');

-- CreateEnum
CREATE TYPE "PaywallSource" AS ENUM ('AUTO_BANNER', 'SEARCH_BUTTON', 'EXPIRING_3_DAYS', 'EXPIRING_1_DAY', 'ACTIVE');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "source" "PaywallSource";

-- CreateTable
CREATE TABLE "PaywallEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PaywallEventType" NOT NULL,
    "source" "PaywallSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaywallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaywallEvent_createdAt_type_source_idx" ON "PaywallEvent"("createdAt", "type", "source");

-- CreateIndex
CREATE INDEX "PaywallEvent_userId_idx" ON "PaywallEvent"("userId");

-- CreateIndex
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");

-- AddForeignKey
ALTER TABLE "PaywallEvent" ADD CONSTRAINT "PaywallEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
