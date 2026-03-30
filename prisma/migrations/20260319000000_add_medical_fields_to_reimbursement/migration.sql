-- AlterTable
ALTER TABLE "reimbursement_requests" 
DROP COLUMN "receiptNumber",
ADD COLUMN     "hospitalName" VARCHAR(255),
ADD COLUMN     "patientName" VARCHAR(255),
ADD COLUMN     "patientRelationship" VARCHAR(50),
ADD COLUMN     "treatmentType" VARCHAR(50);

-- AlterColumn
ALTER TABLE "reimbursement_requests" ALTER COLUMN "receiptUrl" SET NOT NULL;
