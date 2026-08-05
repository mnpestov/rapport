-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Pattern" ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: existing rows only ever had a single imageUrl. Without this,
-- images stays [] for the entire existing dataset and PatternDetails.tsx's
-- gallery would render empty until the first manual re-save through the new
-- form (see pattern_images_plan.md, риск №5).
UPDATE "Pattern" SET "images" = ARRAY["imageUrl"] WHERE cardinality("images") = 0;
UPDATE "Draft" SET "images" = ARRAY["imageUrl"] WHERE cardinality("images") = 0;
