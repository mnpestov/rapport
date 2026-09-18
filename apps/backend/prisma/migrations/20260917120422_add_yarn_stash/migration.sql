-- CreateEnum
CREATE TYPE "YarnCreatedVia" AS ENUM ('AUTHOR', 'STASH_USER');

-- AlterTable
ALTER TABLE "Yarn" ADD COLUMN     "createdVia" "YarnCreatedVia" NOT NULL DEFAULT 'AUTHOR';

-- CreateTable
CREATE TABLE "StashSkein" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "yarnId" TEXT NOT NULL,
    "yarnNameSnapshot" TEXT NOT NULL,
    "brandSnapshot" TEXT,
    "mPer100gSnapshot" INTEGER,
    "compositionSnapshot" TEXT,
    "colorName" TEXT,
    "dyelot" TEXT,
    "totalWeightG" INTEGER NOT NULL,
    "currentWeightG" INTEGER NOT NULL,
    "note" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StashSkein_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StashSwatch" (
    "id" TEXT NOT NULL,
    "skeinId" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "needleSizeRaw" TEXT,
    "densityStitchesBefore" DECIMAL(5,2),
    "densityRowsBefore" DECIMAL(5,2),
    "densityStitchesAfter" DECIMAL(5,2),
    "densityRowsAfter" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StashSwatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StashUsage" (
    "id" TEXT NOT NULL,
    "skeinId" TEXT NOT NULL,
    "amountG" INTEGER NOT NULL,
    "patternId" TEXT,
    "patternTitleSnapshot" TEXT,
    "patternAuthorSnapshot" TEXT,
    "finishedPhotoUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StashUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StashSkein_userId_idx" ON "StashSkein"("userId");

-- CreateIndex
CREATE INDEX "StashSkein_yarnId_idx" ON "StashSkein"("yarnId");

-- CreateIndex
CREATE INDEX "StashSwatch_skeinId_idx" ON "StashSwatch"("skeinId");

-- CreateIndex
CREATE INDEX "StashUsage_skeinId_idx" ON "StashUsage"("skeinId");

-- CreateIndex
CREATE INDEX "StashUsage_patternId_idx" ON "StashUsage"("patternId");

-- AddForeignKey
ALTER TABLE "StashSkein" ADD CONSTRAINT "StashSkein_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StashSkein" ADD CONSTRAINT "StashSkein_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StashSwatch" ADD CONSTRAINT "StashSwatch_skeinId_fkey" FOREIGN KEY ("skeinId") REFERENCES "StashSkein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StashUsage" ADD CONSTRAINT "StashUsage_skeinId_fkey" FOREIGN KEY ("skeinId") REFERENCES "StashSkein"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StashUsage" ADD CONSTRAINT "StashUsage_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "Pattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;
