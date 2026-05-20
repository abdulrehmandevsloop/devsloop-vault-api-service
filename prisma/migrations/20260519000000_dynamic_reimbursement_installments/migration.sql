-- Make reimbursementId nullable to support dynamic-request-based installments
ALTER TABLE "reimbursement_installments" ALTER COLUMN "reimbursementId" DROP NOT NULL;

-- Add dynamicRequestId FK column
ALTER TABLE "reimbursement_installments" ADD COLUMN "dynamicRequestId" TEXT;

-- FK constraint
ALTER TABLE "reimbursement_installments" ADD CONSTRAINT "reimbursement_installments_dynamicRequestId_fkey"
  FOREIGN KEY ("dynamicRequestId") REFERENCES "dynamic_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "reimbursement_installments_dynamicRequestId_idx" ON "reimbursement_installments"("dynamicRequestId");

-- Unique constraint for dynamic request installments
CREATE UNIQUE INDEX "reimbursement_installments_dynamicRequestId_installmentNo_key"
  ON "reimbursement_installments"("dynamicRequestId", "installmentNo");
