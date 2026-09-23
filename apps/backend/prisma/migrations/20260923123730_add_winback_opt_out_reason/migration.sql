-- CreateEnum
CREATE TYPE "WinbackOptOutReason" AS ENUM ('USER', 'UNREACHABLE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "winbackOptOutReason" "WinbackOptOutReason";
