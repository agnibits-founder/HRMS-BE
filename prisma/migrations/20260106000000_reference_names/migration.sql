-- AlterTable
ALTER TABLE "onboardings" ADD COLUMN     "buddyName" TEXT,
ADD COLUMN     "managerName" TEXT;

-- AlterTable
ALTER TABLE "performance_reviews" ADD COLUMN     "reviewerName" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "assigneeName" TEXT;

