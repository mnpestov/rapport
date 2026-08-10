-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "oldPrice" DECIMAL(10,2),
ADD COLUMN     "price" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Pattern" ADD COLUMN     "oldPrice" DECIMAL(10,2),
ADD COLUMN     "price" DECIMAL(10,2);
