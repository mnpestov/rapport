-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastPaywallClickedAt" TIMESTAMP(3),
ADD COLUMN     "lastPaywallShownAt" TIMESTAMP(3);
