-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayrollPeriodStatus" ADD VALUE 'PENDING_REVIEW';
ALTER TYPE "PayrollPeriodStatus" ADD VALUE 'AUTHORIZED';

-- AlterTable
ALTER TABLE "loan_repayments" ALTER COLUMN "remainingBalance" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "payroll_periods" ADD COLUMN     "authorizedAt" TIMESTAMP(3),
ADD COLUMN     "authorizedById" TEXT,
ADD COLUMN     "submittedForReviewAt" TIMESTAMP(3),
ADD COLUMN     "submittedForReviewById" TEXT,
ADD COLUMN     "tempAuthorizerId" TEXT;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_submittedForReviewById_fkey" FOREIGN KEY ("submittedForReviewById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_tempAuthorizerId_fkey" FOREIGN KEY ("tempAuthorizerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
