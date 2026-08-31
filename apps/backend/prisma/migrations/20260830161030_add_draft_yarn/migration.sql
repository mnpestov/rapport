-- CreateTable
CREATE TABLE "DraftYarn" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "yarnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftYarn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DraftYarn_draftId_idx" ON "DraftYarn"("draftId");

-- CreateIndex
CREATE INDEX "DraftYarn_yarnId_idx" ON "DraftYarn"("yarnId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftYarn_draftId_yarnId_key" ON "DraftYarn"("draftId", "yarnId");

-- AddForeignKey
ALTER TABLE "DraftYarn" ADD CONSTRAINT "DraftYarn_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftYarn" ADD CONSTRAINT "DraftYarn_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
