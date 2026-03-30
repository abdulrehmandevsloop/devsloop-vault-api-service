-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PROCESSED');

-- AlterTable
ALTER TABLE "reimbursement_requests" ADD COLUMN     "hasInstallmentPlan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totalInstallments" INTEGER;

-- CreateTable
CREATE TABLE "reimbursement_installments" (
    "id" TEXT NOT NULL,
    "reimbursementId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "scheduledMonth" VARCHAR(7) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "processingNotes" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reimbursement_installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reimbursement_installments_reimbursementId_idx" ON "reimbursement_installments"("reimbursementId");

-- CreateIndex
CREATE INDEX "reimbursement_installments_scheduledMonth_status_idx" ON "reimbursement_installments"("scheduledMonth", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reimbursement_installments_reimbursementId_installmentNo_key" ON "reimbursement_installments"("reimbursementId", "installmentNo");

-- AddForeignKey
ALTER TABLE "reimbursement_installments" ADD CONSTRAINT "reimbursement_installments_reimbursementId_fkey" FOREIGN KEY ("reimbursementId") REFERENCES "reimbursement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reimbursement_installments" ADD CONSTRAINT "reimbursement_installments_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
