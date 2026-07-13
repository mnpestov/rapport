/*
  Warnings:

  - You are about to drop the column `thickness` on the `Draft` table. All the data in the column will be lost.
  - You are about to drop the column `thickness` on the `Pattern` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Draft" DROP COLUMN "thickness";

-- AlterTable
ALTER TABLE "Pattern" DROP COLUMN "thickness";

-- CreateTable
CREATE TABLE "YarnRange" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minValue" INTEGER NOT NULL,
    "maxValue" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "YarnRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_PatternToYarnRange" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PatternToYarnRange_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_DraftToYarnRange" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DraftToYarnRange_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "YarnRange_label_key" ON "YarnRange"("label");

-- CreateIndex
CREATE INDEX "_PatternToYarnRange_B_index" ON "_PatternToYarnRange"("B");

-- CreateIndex
CREATE INDEX "_DraftToYarnRange_B_index" ON "_DraftToYarnRange"("B");

-- AddForeignKey
ALTER TABLE "_PatternToYarnRange" ADD CONSTRAINT "_PatternToYarnRange_A_fkey" FOREIGN KEY ("A") REFERENCES "Pattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PatternToYarnRange" ADD CONSTRAINT "_PatternToYarnRange_B_fkey" FOREIGN KEY ("B") REFERENCES "YarnRange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DraftToYarnRange" ADD CONSTRAINT "_DraftToYarnRange_A_fkey" FOREIGN KEY ("A") REFERENCES "Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DraftToYarnRange" ADD CONSTRAINT "_DraftToYarnRange_B_fkey" FOREIGN KEY ("B") REFERENCES "YarnRange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
