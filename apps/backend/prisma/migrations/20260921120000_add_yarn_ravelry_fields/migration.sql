-- AlterTable
ALTER TABLE "Yarn" ADD COLUMN     "ravelryId" INTEGER,
ADD COLUMN     "photoUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Yarn_ravelryId_key" ON "Yarn"("ravelryId");
