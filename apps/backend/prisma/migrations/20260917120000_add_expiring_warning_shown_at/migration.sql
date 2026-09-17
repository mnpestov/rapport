-- AlterTable
ALTER TABLE "User" ADD COLUMN "expiring3DaysShownAt" TIMESTAMP(3),
ADD COLUMN     "expiring1DayShownAt" TIMESTAMP(3);
