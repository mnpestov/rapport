-- AlterTable
ALTER TABLE "Pattern"
  ALTER COLUMN "densityStitches" TYPE DECIMAL(5,2),
  ALTER COLUMN "densityRows" TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Draft"
  ALTER COLUMN "densityStitches" TYPE DECIMAL(5,2),
  ALTER COLUMN "densityRows" TYPE DECIMAL(5,2);
