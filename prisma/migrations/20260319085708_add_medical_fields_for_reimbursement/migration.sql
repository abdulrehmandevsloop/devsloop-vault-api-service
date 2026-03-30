/*
  Warnings:

  - The `patientRelationship` column on the `reimbursement_requests` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `treatmentType` column on the `reimbursement_requests` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "PatientRelationship" AS ENUM ('SELF', 'PARENT', 'SPOUSE', 'CHILD');

-- CreateEnum
CREATE TYPE "TreatmentType" AS ENUM ('HOSPITALIZATION', 'MEDICINE', 'CONSULTATION', 'LAB_TESTS');

-- AlterTable
ALTER TABLE "reimbursement_requests" DROP COLUMN "patientRelationship",
ADD COLUMN     "patientRelationship" "PatientRelationship",
DROP COLUMN "treatmentType",
ADD COLUMN     "treatmentType" "TreatmentType";
