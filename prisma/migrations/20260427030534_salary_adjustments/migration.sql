-- CreateEnum
CREATE TYPE "SalaryAdjustmentCategory" AS ENUM ('ADDITION', 'DEDUCTION');

-- CreateEnum
CREATE TYPE "SalaryAdjustmentType" AS ENUM ('SALARY_INCREMENT', 'PENDING_SALARY', 'ARREARS_ADJUSTMENT', 'CORRECTION_UNDERPAYMENT', 'LEAVE_DEDUCTION', 'TAX_ADJUSTMENT', 'PENALTY_FINE', 'CORRECTION_OVERPAYMENT');

-- CreateEnum
CREATE TYPE "SalaryAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED');

-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN     "salaryAdditions" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "salaryDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "salary_adjustments" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "yearMonth" VARCHAR(7) NOT NULL,
    "category" "SalaryAdjustmentCategory" NOT NULL,
    "type" "SalaryAdjustmentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "status" "SalaryAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "applyToCurrent" BOOLEAN NOT NULL DEFAULT true,
    "flaggedReview" BOOLEAN NOT NULL DEFAULT false,
    "savedById" TEXT NOT NULL,
    "authorizedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" VARCHAR(2000),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_adjustments_employeeId_idx" ON "salary_adjustments"("employeeId");

-- CreateIndex
CREATE INDEX "salary_adjustments_yearMonth_idx" ON "salary_adjustments"("yearMonth");

-- CreateIndex
CREATE INDEX "salary_adjustments_status_idx" ON "salary_adjustments"("status");

-- CreateIndex
CREATE INDEX "salary_adjustments_yearMonth_status_idx" ON "salary_adjustments"("yearMonth", "status");

-- CreateIndex
CREATE INDEX "salary_adjustments_employeeId_yearMonth_idx" ON "salary_adjustments"("employeeId", "yearMonth");

-- AddForeignKey
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_savedById_fkey" FOREIGN KEY ("savedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
