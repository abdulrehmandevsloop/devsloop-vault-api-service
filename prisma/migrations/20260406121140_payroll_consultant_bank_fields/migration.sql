-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "ConsultantPayMode" AS ENUM ('FIXED', 'DAILY_RATE', 'HOURLY_RATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable users: add bank/province fields
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "accountHolderName" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "bankCode" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "province" VARCHAR(100);

-- AlterTable payroll_lines: add consultant fields
ALTER TABLE "payroll_lines"
  ADD COLUMN IF NOT EXISTS "consultantPayMode" "ConsultantPayMode",
  ADD COLUMN IF NOT EXISTS "contractedDailyRate" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "contractedHourlyRate" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "hoursWorked" DECIMAL(5,1);

-- AlterTable payroll_profiles: add consultant defaults
ALTER TABLE "payroll_profiles"
  ADD COLUMN IF NOT EXISTS "defaultConsultantPayMode" "ConsultantPayMode",
  ADD COLUMN IF NOT EXISTS "defaultDailyRate" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "defaultHourlyRate" DECIMAL(12,2);
