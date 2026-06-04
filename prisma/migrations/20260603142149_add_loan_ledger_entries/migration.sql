-- CreateEnum
CREATE TYPE "LoanLedgerEntryType" AS ENUM ('LOAN_DISBURSAL', 'PAYROLL_DEDUCTION', 'MANUAL_OVERPAYMENT');

-- CreateEnum
CREATE TYPE "LoanPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE');

-- CreateTable
CREATE TABLE "loan_ledger_entries" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "LoanLedgerEntryType" NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "runningBalance" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "LoanPaymentMethod",
    "reference" VARCHAR(255),
    "remarks" VARCHAR(1000),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_ledger_entries_requestId_transactionDate_idx" ON "loan_ledger_entries"("requestId", "transactionDate");

-- Idempotency guard: prevents duplicate payroll-deduction ledger rows for the
-- same installment (reference = 'repayment:<id>'). Partial so MANUAL_OVERPAYMENT
-- and DISBURSAL rows (reference NULL) are unaffected. Hand-added (not generated
-- by Prisma, which cannot express partial unique indexes in the schema).
CREATE UNIQUE INDEX "loan_ledger_entries_requestId_reference_key" ON "loan_ledger_entries"("requestId", "reference") WHERE "reference" IS NOT NULL;

-- CreateIndex
CREATE INDEX "users_employeeStatus_idx" ON "users"("employeeStatus");

-- CreateIndex
CREATE INDEX "users_mustChangePassword_idx" ON "users"("mustChangePassword");

-- AddForeignKey
ALTER TABLE "loan_ledger_entries" ADD CONSTRAINT "loan_ledger_entries_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "dynamic_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_ledger_entries" ADD CONSTRAINT "loan_ledger_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
