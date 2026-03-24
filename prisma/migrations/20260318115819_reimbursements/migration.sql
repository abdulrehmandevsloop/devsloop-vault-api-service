-- CreateEnum
CREATE TYPE "ReimbursementType" AS ENUM ('MEDICAL', 'FOOD', 'FUEL_TRAVELLING', 'IT_GADGETS', 'OTHER');

-- CreateEnum
CREATE TYPE "ReimbursementStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSED');

-- CreateEnum
CREATE TYPE "ReimbursementProcessingType" AS ENUM ('SALARY_ADJUSTMENT', 'SEPARATE_PAYMENT');

-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "domain" DROP NOT NULL,
ALTER COLUMN "description" DROP NOT NULL;

-- CreateTable
CREATE TABLE "reimbursement_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reimbursementType" "ReimbursementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "receiptUrl" VARCHAR(2048),
    "receiptNumber" VARCHAR(100),
    "merchantName" VARCHAR(255),
    "transactionDate" DATE NOT NULL,
    "status" "ReimbursementStatus" NOT NULL DEFAULT 'PENDING',
    "processingType" "ReimbursementProcessingType" NOT NULL DEFAULT 'SALARY_ADJUSTMENT',
    "otherComments" VARCHAR(1000),
    "hrId" TEXT,
    "hrComment" VARCHAR(2000),
    "hrReviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "processedById" TEXT,
    "processingNotes" VARCHAR(1000),
    "salaryMonth" VARCHAR(7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reimbursement_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reimbursement_requests_employeeId_idx" ON "reimbursement_requests"("employeeId");

-- CreateIndex
CREATE INDEX "reimbursement_requests_status_idx" ON "reimbursement_requests"("status");

-- CreateIndex
CREATE INDEX "reimbursement_requests_reimbursementType_idx" ON "reimbursement_requests"("reimbursementType");

-- CreateIndex
CREATE INDEX "reimbursement_requests_transactionDate_idx" ON "reimbursement_requests"("transactionDate");

-- CreateIndex
CREATE INDEX "reimbursement_requests_hrId_idx" ON "reimbursement_requests"("hrId");

-- CreateIndex
CREATE INDEX "reimbursement_requests_salaryMonth_idx" ON "reimbursement_requests"("salaryMonth");

-- CreateIndex
CREATE INDEX "reimbursement_requests_employeeId_status_idx" ON "reimbursement_requests"("employeeId", "status");

-- CreateIndex
CREATE INDEX "reimbursement_requests_status_reimbursementType_idx" ON "reimbursement_requests"("status", "reimbursementType");

-- AddForeignKey
ALTER TABLE "reimbursement_requests" ADD CONSTRAINT "reimbursement_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reimbursement_requests" ADD CONSTRAINT "reimbursement_requests_hrId_fkey" FOREIGN KEY ("hrId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reimbursement_requests" ADD CONSTRAINT "reimbursement_requests_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
