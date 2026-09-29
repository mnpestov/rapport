-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'PAUSED');

-- AlterTable
ALTER TABLE "StashUsage" ADD COLUMN     "isBackdatedCompletion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "manualAuthor" TEXT,
    "manualDescription" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "note" TEXT,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "finishedPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referencePhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPattern" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "patternId" TEXT,
    "patternTitleSnapshot" TEXT NOT NULL,
    "patternAuthorSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectYarn" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "skeinId" TEXT,
    "yarnNameSnapshot" TEXT NOT NULL,
    "brandSnapshot" TEXT,
    "amountAtCompletionG" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectYarn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSwatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "needleSizeRaw" TEXT,
    "strandsCount" INTEGER,
    "densityStitchesBefore" DECIMAL(5,2),
    "densityRowsBefore" DECIMAL(5,2),
    "densityStitchesAfter" DECIMAL(5,2),
    "densityRowsAfter" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSwatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocumentHighlight" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "rects" JSONB NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDocumentHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_InstrumentToProject" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_InstrumentToProject_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "ProjectPattern_patternId_idx" ON "ProjectPattern"("patternId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPattern_projectId_patternId_key" ON "ProjectPattern"("projectId", "patternId");

-- CreateIndex
CREATE INDEX "ProjectYarn_skeinId_idx" ON "ProjectYarn"("skeinId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectYarn_projectId_skeinId_key" ON "ProjectYarn"("projectId", "skeinId");

-- CreateIndex
CREATE INDEX "ProjectSwatch_projectId_idx" ON "ProjectSwatch"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDocument_storedFileName_key" ON "ProjectDocument"("storedFileName");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_idx" ON "ProjectDocument"("projectId");

-- CreateIndex
CREATE INDEX "ProjectDocumentHighlight_documentId_idx" ON "ProjectDocumentHighlight"("documentId");

-- CreateIndex
CREATE INDEX "_InstrumentToProject_B_index" ON "_InstrumentToProject"("B");

-- CreateIndex
CREATE INDEX "StashUsage_projectId_idx" ON "StashUsage"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StashUsage_projectId_skeinId_key" ON "StashUsage"("projectId", "skeinId");

-- AddForeignKey
ALTER TABLE "StashUsage" ADD CONSTRAINT "StashUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPattern" ADD CONSTRAINT "ProjectPattern_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPattern" ADD CONSTRAINT "ProjectPattern_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "Pattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectYarn" ADD CONSTRAINT "ProjectYarn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectYarn" ADD CONSTRAINT "ProjectYarn_skeinId_fkey" FOREIGN KEY ("skeinId") REFERENCES "StashSkein"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSwatch" ADD CONSTRAINT "ProjectSwatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocumentHighlight" ADD CONSTRAINT "ProjectDocumentHighlight_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InstrumentToProject" ADD CONSTRAINT "_InstrumentToProject_A_fkey" FOREIGN KEY ("A") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InstrumentToProject" ADD CONSTRAINT "_InstrumentToProject_B_fkey" FOREIGN KEY ("B") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

