-- AlterTable
ALTER TABLE "User" ADD COLUMN     "winbackCheckinSentAt" TIMESTAMP(3),
ADD COLUMN     "winbackOptedOutAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "WinbackReason" AS ENUM ('DIDNT_FIND_PATTERN', 'HARD_TO_USE', 'ALL_GOOD');

-- CreateTable
CREATE TABLE "WinbackResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "WinbackReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WinbackResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WinbackResponse_userId_idx" ON "WinbackResponse"("userId");

-- CreateIndex
CREATE INDEX "WinbackResponse_createdAt_reason_idx" ON "WinbackResponse"("createdAt", "reason");

-- AddForeignKey
ALTER TABLE "WinbackResponse" ADD CONSTRAINT "WinbackResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
