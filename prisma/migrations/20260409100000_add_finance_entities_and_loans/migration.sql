-- Baseline migration: Add finance entities and loan_requests table
-- This matches what was applied to the database on 2026-04-09

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'DISBURSED');

-- CreateTable
CREATE TABLE "loan_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "purpose" VARCHAR(2000) NOT NULL,
    "requestedRepaymentMonths" INTEGER NOT NULL,
    "notes" VARCHAR(1000),
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" VARCHAR(2000),
    "approvedAmount" DECIMAL(12,2),
    "approvedRepaymentMonths" INTEGER,
    "monthlyDeduction" DECIMAL(12,2),
    "disbursedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_requests_employeeId_idx" ON "loan_requests"("employeeId");
CREATE INDEX "loan_requests_status_idx" ON "loan_requests"("status");
CREATE INDEX "loan_requests_employeeId_status_idx" ON "loan_requests"("employeeId", "status");

-- AddForeignKey
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
