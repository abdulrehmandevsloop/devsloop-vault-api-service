-- CreateEnum
CREATE TYPE "LoanRepaymentStatus" AS ENUM ('PENDING', 'DEDUCTED', 'SKIPPED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoanStatus" ADD VALUE 'REPAYING';
ALTER TYPE "LoanStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "loan_requests" ADD COLUMN     "disbursedById" TEXT,
ADD COLUMN     "remainingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "repaymentStartMonth" VARCHAR(7),
ADD COLUMN     "totalRepaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "loan_repayments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "scheduledMonth" VARCHAR(7) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "LoanRepaymentStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "processingNote" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_repayments_loanId_idx" ON "loan_repayments"("loanId");

-- CreateIndex
CREATE INDEX "loan_repayments_scheduledMonth_status_idx" ON "loan_repayments"("scheduledMonth", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayments_loanId_installmentNo_key" ON "loan_repayments"("loanId", "installmentNo");

-- AddForeignKey
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_disbursedById_fkey" FOREIGN KEY ("disbursedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loan_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
