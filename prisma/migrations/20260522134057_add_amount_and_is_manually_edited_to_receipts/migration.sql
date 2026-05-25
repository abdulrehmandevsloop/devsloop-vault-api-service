-- AlterTable
ALTER TABLE "reimbursement_receipts" ADD COLUMN     "amount" DECIMAL(12,2),
ADD COLUMN     "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "updatedAt" DROP DEFAULT;
