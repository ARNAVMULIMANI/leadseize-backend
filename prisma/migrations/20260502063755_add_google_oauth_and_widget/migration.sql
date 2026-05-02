-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "googleAccessToken" TEXT,
ADD COLUMN     "googleLocationId" TEXT,
ADD COLUMN     "googleRefreshToken" TEXT;

-- AlterTable
ALTER TABLE "GoogleReview" ADD COLUMN     "googleReviewId" TEXT;
