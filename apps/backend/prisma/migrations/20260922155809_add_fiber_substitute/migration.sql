-- CreateEnum
CREATE TYPE "FiberSubstituteLevel" AS ENUM ('A', 'B', 'C', 'X');

-- CreateEnum
CREATE TYPE "FiberSubstituteRole" AS ENUM ('MATERIAL', 'FUNCTIONAL', 'VISUAL', 'DECORATIVE');

-- CreateTable
CREATE TABLE "FiberSubstitute" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "level" "FiberSubstituteLevel" NOT NULL,
    "role" "FiberSubstituteRole" NOT NULL DEFAULT 'MATERIAL',
    "symmetric" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FiberSubstitute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiberSubstitute_source_target_key" ON "FiberSubstitute"("source", "target");

-- CreateIndex
CREATE INDEX "FiberSubstitute_source_idx" ON "FiberSubstitute"("source");

-- CreateIndex
CREATE INDEX "FiberSubstitute_target_idx" ON "FiberSubstitute"("target");
