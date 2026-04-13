-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('DRAFT', 'LOCKED');

-- AlterEnum
ALTER TYPE "EmployeeStatus" ADD VALUE 'HOLD';

-- CreateTable
CREATE TABLE "payroll_profiles" (
    "userId" TEXT NOT NULL,
    "rentalAllowanceMonthly" DECIMAL(12,2),
    "commuteAllowanceMonthly" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" TEXT NOT NULL,
    "yearMonth" VARCHAR(7) NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "lunchRatePerDay" DECIMAL(12,2) NOT NULL DEFAULT 200,
    "defaultTaxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "lastExportChecksum" DECIMAL(18,2),
    "lastExportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    "employeeCode" VARCHAR(50),
    "departments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "designation" VARCHAR(255),
    "employeeType" "EmployeeType",
    "employeeStatus" "EmployeeStatus" NOT NULL,
    "baseSalaryMonthly" DECIMAL(12,2) NOT NULL,
    "rentalAllowanceMonthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "commuteAllowanceMonthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extraWorkingDays" INTEGER NOT NULL DEFAULT 0,
    "pendingWorkingDays" INTEGER,
    "performanceBonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reimbursementManual" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "includeHrReimbursements" BOOLEAN NOT NULL DEFAULT true,
    "deductionTaxable" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductionNonTaxable" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fines" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "loanDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "advanceDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxPercentOverride" DECIMAL(5,2),
    "standardWorkingDays" INTEGER NOT NULL DEFAULT 0,
    "reimbursementFromHr" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtimeEarnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "basicProRated" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grossSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "foodDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netSalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustment_audits" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "field" VARCHAR(64) NOT NULL,
    "oldValue" VARCHAR(500),
    "newValue" VARCHAR(500),
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustment_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_yearMonth_key" ON "payroll_periods"("yearMonth");

-- CreateIndex
CREATE INDEX "payroll_periods_yearMonth_idx" ON "payroll_periods"("yearMonth");

-- CreateIndex
CREATE INDEX "payroll_lines_periodId_idx" ON "payroll_lines"("periodId");

-- CreateIndex
CREATE INDEX "payroll_lines_userId_idx" ON "payroll_lines"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_periodId_userId_key" ON "payroll_lines"("periodId", "userId");

-- CreateIndex
CREATE INDEX "payroll_adjustment_audits_lineId_idx" ON "payroll_adjustment_audits"("lineId");

-- CreateIndex
CREATE INDEX "payroll_adjustment_audits_actorId_idx" ON "payroll_adjustment_audits"("actorId");

-- AddForeignKey
ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustment_audits" ADD CONSTRAINT "payroll_adjustment_audits_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "payroll_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustment_audits" ADD CONSTRAINT "payroll_adjustment_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
