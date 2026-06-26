-- AlterTable
ALTER TABLE "WhitelistedUser" ADD COLUMN     "debugLogging" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forceAllow" BOOLEAN NOT NULL DEFAULT true;
