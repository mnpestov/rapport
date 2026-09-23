-- AlterTable
ALTER TABLE "WinbackResponse" ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "WinbackResponse_isRead_idx" ON "WinbackResponse"("isRead");
