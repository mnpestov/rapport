-- AlterTable
ALTER TABLE "Pattern" ADD COLUMN     "popularityScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Pattern_popularityScore_id_idx" ON "Pattern"("popularityScore", "id");
