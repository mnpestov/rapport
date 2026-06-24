-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'AUTHOR', 'ADMIN');

-- AlterTable
-- Existing rows are backfilled with the DEFAULT 'USER' automatically.
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "LoginCode" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatternView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternLinkClick" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatternLinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscribeClick" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscribeClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginCode_telegramId_idx" ON "LoginCode"("telegramId");

-- CreateIndex
CREATE INDEX "PatternView_userId_idx" ON "PatternView"("userId");

-- CreateIndex
CREATE INDEX "PatternView_patternId_idx" ON "PatternView"("patternId");

-- CreateIndex
CREATE INDEX "PatternLinkClick_userId_idx" ON "PatternLinkClick"("userId");

-- CreateIndex
CREATE INDEX "PatternLinkClick_patternId_idx" ON "PatternLinkClick"("patternId");

-- CreateIndex
CREATE INDEX "SubscribeClick_userId_idx" ON "SubscribeClick"("userId");
