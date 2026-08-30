-- CreateEnum
CREATE TYPE "LoginCodePurpose" AS ENUM ('LOGIN', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'NEEDS_INFO', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "LoginCode" ADD COLUMN     "purpose" "LoginCodePurpose" NOT NULL DEFAULT 'LOGIN';

-- CreateTable
CREATE TABLE "AuthorApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorName" VARCHAR(120) NOT NULL,
    "resources" TEXT[],
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "adminComment" TEXT,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthorApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "AuthorCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthorApplication_userId_idx" ON "AuthorApplication"("userId");

-- CreateIndex
CREATE INDEX "AuthorApplication_status_idx" ON "AuthorApplication"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorCredential_userId_key" ON "AuthorCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorCredential_login_key" ON "AuthorCredential"("login");

-- AddForeignKey
ALTER TABLE "AuthorApplication" ADD CONSTRAINT "AuthorApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorCredential" ADD CONSTRAINT "AuthorCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: at most one PENDING application per user. Prisma
-- cannot express partial indexes in schema.prisma syntax — added by hand,
-- same pattern as Draft_active_patternId_key
-- (see prisma/migrations/20260707000000_add_draft_userpermission).
-- NEEDS_INFO/REJECTED are deliberately NOT covered — see the model comment
-- in schema.prisma for why.
CREATE UNIQUE INDEX "AuthorApplication_pending_userId_key"
  ON "AuthorApplication"("userId")
  WHERE status = 'PENDING';
