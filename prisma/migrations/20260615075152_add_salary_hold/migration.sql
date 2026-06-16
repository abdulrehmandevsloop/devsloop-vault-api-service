-- CreateEnum
CREATE TYPE "SalaryHoldStatus" AS ENUM ('ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalaryHoldLedgerType" AS ENUM ('HOLD_ACCRUAL', 'RELEASE');

-- AlterEnum
ALTER TYPE "SalaryAdjustmentType" ADD VALUE 'HELD_SALARY_RELEASE';

-- CreateTable
CREATE TABLE "salary_holds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "SalaryHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "heldBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(1000),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_hold_ledger_entries" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "type" "SalaryHoldLedgerType" NOT NULL,
    "yearMonth" VARCHAR(7) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "runningBalance" DECIMAL(12,2) NOT NULL,
    "periodId" TEXT,
    "reference" VARCHAR(255),
    "remarks" VARCHAR(1000),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_hold_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_holds_userId_idx" ON "salary_holds"("userId");

-- CreateIndex
CREATE INDEX "salary_holds_status_idx" ON "salary_holds"("status");

-- CreateIndex
CREATE INDEX "salary_hold_ledger_entries_holdId_idx" ON "salary_hold_ledger_entries"("holdId");

-- CreateIndex
CREATE UNIQUE INDEX "salary_hold_ledger_entries_holdId_periodId_type_key" ON "salary_hold_ledger_entries"("holdId", "periodId", "type");

-- AddForeignKey
ALTER TABLE "salary_holds" ADD CONSTRAINT "salary_holds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_holds" ADD CONSTRAINT "salary_holds_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_hold_ledger_entries" ADD CONSTRAINT "salary_hold_ledger_entries_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "salary_holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
