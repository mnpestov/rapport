-- CreateEnum
CREATE TYPE "YarnLinkSource" AS ENUM ('SCRAPER', 'ADMIN', 'BACKFILL');

-- CreateEnum
CREATE TYPE "YarnLinkStatus" AS ENUM ('ACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "YarnMatchRule" AS ENUM ('EXACT', 'PARTIAL', 'SHORT_FORM', 'FAMILY', 'LINE_NAME', 'BRAND_LEVEL', 'AUTHOR_METRAGE', 'GENERIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "YarnMentionKind" AS ENUM ('FAMILY', 'BRAND_ONLY', 'UNKNOWN_ARTICLE');

-- CreateEnum
CREATE TYPE "YarnMentionStatus" AS ENUM ('PENDING', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Yarn" (
    "id" TEXT NOT NULL,
    "brand" TEXT,
    "line" TEXT,
    "name" TEXT NOT NULL,
    "normalizedKey" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "isGeneric" BOOLEAN NOT NULL DEFAULT false,
    "mPer100g" INTEGER,
    "composition" TEXT,
    "needleSizeRaw" TEXT,
    "needleMinMm" DOUBLE PRECISION,
    "needleMaxMm" DOUBLE PRECISION,
    "densityRaw" TEXT,
    "densityStitches" INTEGER,
    "densityRows" INTEGER,
    "ballWeightG" INTEGER,
    "ballLengthM" INTEGER,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Yarn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YarnAlias" (
    "id" TEXT NOT NULL,
    "yarnId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YarnAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternYarn" (
    "id" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "yarnId" TEXT NOT NULL,
    "rawMention" TEXT,
    "metrageInText" TEXT,
    "source" "YarnLinkSource" NOT NULL,
    "status" "YarnLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "matchRule" "YarnMatchRule",
    "detailsHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatternYarn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternYarnMention" (
    "id" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "metrageInText" TEXT,
    "kind" "YarnMentionKind" NOT NULL,
    "suggestedYarnId" TEXT,
    "matchRule" "YarnMatchRule",
    "resolvedYarnId" TEXT,
    "status" "YarnMentionStatus" NOT NULL DEFAULT 'PENDING',
    "detailsHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatternYarnMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Yarn_normalizedKey_key" ON "Yarn"("normalizedKey");

-- CreateIndex
CREATE INDEX "Yarn_dedupKey_idx" ON "Yarn"("dedupKey");

-- CreateIndex
CREATE INDEX "Yarn_brand_idx" ON "Yarn"("brand");

-- CreateIndex
CREATE UNIQUE INDEX "YarnAlias_normalizedAlias_key" ON "YarnAlias"("normalizedAlias");

-- CreateIndex
CREATE INDEX "YarnAlias_yarnId_idx" ON "YarnAlias"("yarnId");

-- CreateIndex
CREATE INDEX "PatternYarn_patternId_idx" ON "PatternYarn"("patternId");

-- CreateIndex
CREATE INDEX "PatternYarn_yarnId_idx" ON "PatternYarn"("yarnId");

-- CreateIndex
CREATE UNIQUE INDEX "PatternYarn_patternId_yarnId_key" ON "PatternYarn"("patternId", "yarnId");

-- CreateIndex
CREATE INDEX "PatternYarnMention_patternId_idx" ON "PatternYarnMention"("patternId");

-- CreateIndex
CREATE INDEX "PatternYarnMention_status_idx" ON "PatternYarnMention"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PatternYarnMention_patternId_rawText_key" ON "PatternYarnMention"("patternId", "rawText");

-- AddForeignKey
ALTER TABLE "Yarn" ADD CONSTRAINT "Yarn_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Yarn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YarnAlias" ADD CONSTRAINT "YarnAlias_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternYarn" ADD CONSTRAINT "PatternYarn_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "Pattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternYarn" ADD CONSTRAINT "PatternYarn_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternYarnMention" ADD CONSTRAINT "PatternYarnMention_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "Pattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternYarnMention" ADD CONSTRAINT "PatternYarnMention_suggestedYarnId_fkey" FOREIGN KEY ("suggestedYarnId") REFERENCES "Yarn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternYarnMention" ADD CONSTRAINT "PatternYarnMention_resolvedYarnId_fkey" FOREIGN KEY ("resolvedYarnId") REFERENCES "Yarn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

