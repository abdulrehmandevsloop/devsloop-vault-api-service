-- CreateEnum
CREATE TYPE "EngagementType" AS ENUM ('FULL_TIME', 'HALF_TIME', 'CONTRACTUAL');

-- AlterTable
ALTER TABLE "loan_repayments" ALTER COLUMN "remainingBalance" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_projects" ADD COLUMN     "engagementType" "EngagementType" NOT NULL DEFAULT 'FULL_TIME';
