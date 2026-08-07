-- AlterTable
ALTER TABLE "Pattern" ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- Backfill: for patterns already visible, the best available "went live"
-- timestamp is their createdAt. Archived (isVisible = false) rows are left
-- NULL — they haven't been published yet, so the isNew auto-expiry job
-- correctly leaves them untouched until an admin actually publishes them.
UPDATE "Pattern" SET "publishedAt" = "createdAt" WHERE "isVisible" = true AND "publishedAt" IS NULL;
