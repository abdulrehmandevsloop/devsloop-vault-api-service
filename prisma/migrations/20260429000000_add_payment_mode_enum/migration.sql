-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('LOCAL_BANK', 'UAE', 'SIMPLE_REMITTANCE');

-- AlterTable: replace payViaRemittance boolean with PaymentMode enum on payroll_profiles
ALTER TABLE "payroll_profiles"
  ADD COLUMN "paymentMode" "PaymentMode" NOT NULL DEFAULT 'LOCAL_BANK';

UPDATE "payroll_profiles"
  SET "paymentMode" = 'SIMPLE_REMITTANCE'
  WHERE "payViaRemittance" = true;

ALTER TABLE "payroll_profiles"
  DROP COLUMN "payViaRemittance";

-- AlterTable: replace payViaRemittance boolean with PaymentMode enum on payroll_lines
ALTER TABLE "payroll_lines"
  ADD COLUMN "paymentMode" "PaymentMode" NOT NULL DEFAULT 'LOCAL_BANK';

UPDATE "payroll_lines"
  SET "paymentMode" = 'SIMPLE_REMITTANCE'
  WHERE "payViaRemittance" = true;

ALTER TABLE "payroll_lines"
  DROP COLUMN "payViaRemittance";
