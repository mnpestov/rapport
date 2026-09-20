-- CreateEnum
CREATE TYPE "YarnFieldSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "YarnFieldSuggestion" (
    "id" TEXT NOT NULL,
    "yarnId" TEXT NOT NULL,
    "suggestedById" TEXT NOT NULL,
    "stashSkeinId" TEXT,
    "mPer100g" INTEGER,
    "composition" TEXT,
    "needleSizeRaw" TEXT,
    "densityRaw" TEXT,
    "ballWeightG" INTEGER,
    "ballLengthM" INTEGER,
    "status" "YarnFieldSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YarnFieldSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YarnFieldSuggestion_yarnId_idx" ON "YarnFieldSuggestion"("yarnId");

-- CreateIndex
CREATE INDEX "YarnFieldSuggestion_status_idx" ON "YarnFieldSuggestion"("status");

-- AddForeignKey
ALTER TABLE "YarnFieldSuggestion" ADD CONSTRAINT "YarnFieldSuggestion_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YarnFieldSuggestion" ADD CONSTRAINT "YarnFieldSuggestion_suggestedById_fkey" FOREIGN KEY ("suggestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
