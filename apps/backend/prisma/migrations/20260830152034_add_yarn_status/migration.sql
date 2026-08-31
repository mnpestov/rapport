-- CreateEnum
CREATE TYPE "YarnStatus" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "Yarn" ADD COLUMN     "status" "YarnStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateIndex
CREATE INDEX "Yarn_status_idx" ON "Yarn"("status");
