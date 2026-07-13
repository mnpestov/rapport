-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "densityRows" INTEGER,
ADD COLUMN     "densityStitches" INTEGER,
ADD COLUMN     "thickness" TEXT;

-- AlterTable
ALTER TABLE "Pattern" ADD COLUMN     "densityRows" INTEGER,
ADD COLUMN     "densityStitches" INTEGER,
ADD COLUMN     "thickness" TEXT;
