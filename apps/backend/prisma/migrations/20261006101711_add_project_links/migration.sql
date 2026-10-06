-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "links" TEXT[] DEFAULT ARRAY[]::TEXT[];
