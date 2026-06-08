/*
  Warnings:

  - You are about to drop the column `merchantName` on the `reimbursement_requests` table. All the data in the column will be lost.
  - You are about to drop the column `receiptUrl` on the `reimbursement_requests` table. All the data in the column will be lost.
  - You are about to drop the column `transactionDate` on the `reimbursement_requests` table. All the data in the column will be lost.

*/



-- Step 1: Drop the old index (no longer needed)
DROP INDEX "reimbursement_requests_transactionDate_idx";

-- Step 2: Create the new receipts table (with all columns)
CREATE TABLE "reimbursement_receipts" (
    "id" TEXT NOT NULL,
    "reimbursementId" TEXT NOT NULL,
    "receiptUrl" VARCHAR(2048),
    "merchantName" VARCHAR(255),
    "transactionDate" DATE NOT NULL,
    "amount" DECIMAL(12,2),
    "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reimbursement_receipts_pkey" PRIMARY KEY ("id")
);

-- Step 3: Add indexes
CREATE INDEX "reimbursement_receipts_reimbursementId_idx" ON "reimbursement_receipts"("reimbursementId");
CREATE INDEX "reimbursement_receipts_transactionDate_idx" ON "reimbursement_receipts"("transactionDate");

-- Step 4: Add foreign key with cascade
ALTER TABLE "reimbursement_receipts" ADD CONSTRAINT "reimbursement_receipts_reimbursementId_fkey" FOREIGN KEY ("reimbursementId") REFERENCES "reimbursement_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 5: BACKFILL — copy existing data before dropping columns
-- Each existing reimbursement_request gets one receipt row with its current data
-- Note: gen_random_uuid() is used here as PostgreSQL has no native CUID generator;
-- new records created through the app will receive CUIDs via Prisma's @default(cuid())
INSERT INTO "reimbursement_receipts" ("id", "reimbursementId", "receiptUrl", "merchantName", "transactionDate", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  "id",
  "receiptUrl",
  "merchantName",
  "transactionDate",
  "createdAt",
  "createdAt"
FROM "reimbursement_requests";

-- Step 6: Now safe to drop the old columns
ALTER TABLE "reimbursement_requests" DROP COLUMN "merchantName",
DROP COLUMN "receiptUrl",
DROP COLUMN "transactionDate";
