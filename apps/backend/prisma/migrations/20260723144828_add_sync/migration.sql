-- CreateEnum
CREATE TYPE "AuthorSyncReportStatus" AS ENUM ('PENDING', 'PROCESSED');

-- CreateEnum
CREATE TYPE "AuthorSyncItemStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "AuthorSyncReport" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" "AuthorSyncReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorSyncReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorSyncItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" "AuthorSyncItemStatus" NOT NULL DEFAULT 'PENDING',
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parsedData" JSONB NOT NULL,

    CONSTRAINT "AuthorSyncItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthorSyncReport_status_idx" ON "AuthorSyncReport"("status");

-- CreateIndex
CREATE INDEX "AuthorSyncItem_reportId_idx" ON "AuthorSyncItem"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorSyncItem_reportId_url_key" ON "AuthorSyncItem"("reportId", "url");

-- AddForeignKey
ALTER TABLE "AuthorSyncReport" ADD CONSTRAINT "AuthorSyncReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Author"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorSyncItem" ADD CONSTRAINT "AuthorSyncItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AuthorSyncReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreatePartialIndex for unique PENDING report per author
CREATE UNIQUE INDEX "AuthorSyncReport_authorId_pending_idx" 
ON "AuthorSyncReport" ("authorId") WHERE status = 'PENDING';
