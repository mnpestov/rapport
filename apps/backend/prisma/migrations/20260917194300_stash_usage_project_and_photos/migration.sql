/*
  Warnings:

  - You are about to drop the column `finishedPhotoUrl` on the `StashUsage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StashUsage" DROP COLUMN "finishedPhotoUrl",
ADD COLUMN     "finishedPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "projectTitle" TEXT;
