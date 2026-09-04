-- AlterTable
ALTER TABLE "Author" ADD COLUMN     "comment" TEXT,
ADD COLUMN     "contentPermissionRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "removalRequested" BOOLEAN NOT NULL DEFAULT false;
