-- CreateEnum
CREATE TYPE "AdvanceSalaryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'DISBURSED', 'REPAYING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AdvanceSalaryRepaymentStatus" AS ENUM ('PENDING', 'DEDUCTED', 'SKIPPED');

-- CreateTable
CREATE TABLE "advance_salary_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(2000) NOT NULL,
    "requestedRepaymentMonths" INTEGER NOT NULL,
    "notes" VARCHAR(1000),
    "monthlyDeduction" DECIMAL(12,2),
    "status" "AdvanceSalaryStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" VARCHAR(2000),
    "approvedAmount" DECIMAL(12,2),
    "approvedRepaymentMonths" INTEGER,
    "disbursedAt" TIMESTAMP(3),
    "disbursedById" TEXT,
    "repaymentStartMonth" VARCHAR(7),
    "totalRepaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remainingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advance_salary_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_salary_repayments" (
    "id" TEXT NOT NULL,
    "advanceSalaryId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "scheduledMonth" VARCHAR(7) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "AdvanceSalaryRepaymentStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "processingNote" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advance_salary_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advance_salary_requests_employeeId_idx" ON "advance_salary_requests"("employeeId");

-- CreateIndex
CREATE INDEX "advance_salary_requests_status_idx" ON "advance_salary_requests"("status");

-- CreateIndex
CREATE INDEX "advance_salary_requests_employeeId_status_idx" ON "advance_salary_requests"("employeeId", "status");

-- CreateIndex
CREATE INDEX "advance_salary_repayments_advanceSalaryId_idx" ON "advance_salary_repayments"("advanceSalaryId");

-- CreateIndex
CREATE INDEX "advance_salary_repayments_scheduledMonth_status_idx" ON "advance_salary_repayments"("scheduledMonth", "status");

-- CreateIndex
CREATE UNIQUE INDEX "advance_salary_repayments_advanceSalaryId_installmentNo_key" ON "advance_salary_repayments"("advanceSalaryId", "installmentNo");

-- AddForeignKey
ALTER TABLE "advance_salary_requests" ADD CONSTRAINT "advance_salary_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_salary_requests" ADD CONSTRAINT "advance_salary_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_salary_requests" ADD CONSTRAINT "advance_salary_requests_disbursedById_fkey" FOREIGN KEY ("disbursedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_salary_repayments" ADD CONSTRAINT "advance_salary_repayments_advanceSalaryId_fkey" FOREIGN KEY ("advanceSalaryId") REFERENCES "advance_salary_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_salary_repayments" ADD CONSTRAINT "advance_salary_repayments_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
